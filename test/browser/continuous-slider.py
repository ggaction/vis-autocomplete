from canvas_testing import observe_canvas, canvas_text
"""Continuous thumb motion with discrete parameters and unchanged Apply semantics."""
from pathlib import Path
from playwright.sync_api import sync_playwright, expect


with sync_playwright() as p:
    browser = p.chromium.launch(
        headless=True, executable_path="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")
    page = browser.new_page(viewport={"width": 1600, "height": 1100})
    observe_canvas(page)
    page.add_init_script("""{
      const NativeWorker = window.Worker;
      window.preparationRequests = 0;
      window.Worker = class extends NativeWorker {
        postMessage(message, ...rest) {
          if (message?.request?.type === 'prepare') window.preparationRequests++;
          return super.postMessage(message, ...rest);
        }
      };
    }""")
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.goto("http://127.0.0.1:5173/")
    page.wait_for_load_state("networkidle")
    for field in ["Horsepower", "Miles_per_Gallon"]:
        page.get_by_role("button", name="Select column " + field, exact=True).click()
    card = page.locator(".card[data-method=createScatterPlot]")
    expect(card).to_be_visible(timeout=60000)
    card.locator(".card-top").hover()
    card.locator(".apply-button").click()
    expect(page.locator("#current")).to_have_attribute("data-steps", "1", timeout=60000)
    page.locator("#group-style").click()
    page.locator("#action-search").fill("createTitle")
    card = page.locator(".card[data-method=createTitle]")
    expect(card).to_be_visible(timeout=60000)
    card.locator(".card-top").hover()
    page.wait_for_timeout(400)
    slider = card.locator('[data-parameter="size"] input')
    track = card.locator('[data-parameter="size"] .number-control')
    box = slider.bounding_box()

    def move(fraction):
        x = box["x"] + 6 + fraction * (box["width"] - 12)
        y = box["y"] + box["height"] / 2
        page.mouse.move(x, y)
        page.wait_for_timeout(60)
        return x, y

    def thumb_position():
        return track.evaluate("e => parseFloat(getComputedStyle(e, '::after').left)")

    # Both positions map to 18, but their thumb positions must be distinct.
    move(.400)
    expect(slider).to_have_value("18")
    expect(card).to_have_attribute("data-preview-state", "ready", timeout=30000)
    page.wait_for_timeout(200)
    before = page.evaluate("window.preparationRequests")
    positions = [thumb_position()]
    for fraction in [.405, .410, .415, .420]:
        move(fraction)
        expect(slider).to_have_value("18")
        positions.append(thumb_position())
    assert all(a < b for a, b in zip(positions, positions[1:])), positions
    assert page.evaluate("window.preparationRequests") == before, "Sub-step motion must not recompute the chart"
    expect(page.locator("#code-content")).to_contain_text('"fontSize": 18')
    expect(page.locator("#current")).to_have_attribute("data-steps", "1")

    # Fixing keeps the exact visual position, even between discrete tick positions.
    x, y = move(.420)
    page.mouse.click(x, y)
    expect(slider).to_have_attribute("data-locked", "true")
    fixed = thumb_position()
    x, y = move(.650)
    assert thumb_position() == fixed
    expect(slider).to_have_value("18")
    page.mouse.click(x, y)
    expect(slider).to_have_attribute("data-locked", "false")
    move(.660)
    expect(slider).to_have_value("23")
    assert thumb_position() > fixed

    # Native keyboard semantics still expose and apply integer values.
    slider.press("ArrowRight")
    expect(slider).to_have_value("24")
    expect(slider).to_have_attribute("data-locked", "true")
    slider.press("Home")
    expect(slider).to_have_value("10")
    assert thumb_position() == 0
    slider.press("End")
    expect(slider).to_have_value("30")
    slider.press("ArrowLeft")
    expect(slider).to_have_value("29")
    expect(page.locator("#code-content")).to_contain_text('"fontSize": 29', timeout=30000)
    # Touch uses the native range track; it must also retain continuous motion
    # without leaking fractional values into an integer-only parameter.
    touch = page.context.new_cdp_session(page)
    for kind, fraction in [("touchStart", .30), ("touchMove", .48)]:
        touch.send("Input.dispatchTouchEvent", {"type": kind, "touchPoints": [{
            "x": box["x"] + 6 + fraction * (box["width"] - 12),
            "y": box["y"] + box["height"] / 2,
        }]})
    touch.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []})
    expect(slider).to_have_value("20")
    expect(slider).to_have_attribute("data-locked", "true")
    card.locator(".card-top").hover()
    expect(page.locator("#code-content")).to_contain_text('"fontSize": 20', timeout=30000)
    Path("output/applied-actions").mkdir(parents=True, exist_ok=True)
    card.screenshot(path="output/applied-actions/continuous-slider.png")
    card.locator(".apply-button").click()
    expect(page.locator("#current")).to_have_attribute("data-steps", "2", timeout=60000)
    canvas_text(page,'#current canvas','',font_size='20')
    assert not errors, errors
    print("PASS continuous sub-step thumb motion without recomputation; pin/resume, keyboard, touch and Apply")
    browser.close()
