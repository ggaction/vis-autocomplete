from canvas_testing import observe_canvas, canvas_text
"""Title/subtitle controls, preview, Apply and editing against the running app."""
from playwright.sync_api import sync_playwright, expect


def search(page, method):
    page.locator("#action-search").fill(method)
    expect(page.locator("#cards")).to_have_attribute("data-search-query", method.lower(), timeout=60000)
    card = page.locator(f".card[data-method={method}]")
    expect(card).to_be_visible(timeout=60000)
    card.locator(".card-top").hover()
    return card


with sync_playwright() as p:
    browser = p.chromium.launch(
        headless=True, executable_path="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")
    page = browser.new_page(viewport={"width": 1600, "height": 1100})
    observe_canvas(page)
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
    card = search(page, "createTitle")
    assert card.locator('[data-parameter="weight"]').count() == 0
    assert card.locator(".card-controls > .control").count() == 4
    card.locator('[data-parameter="text"] input').fill("Cars")
    card.locator('[data-parameter="subtitle"] input').fill("Fuel economy by horsepower")
    slider = card.locator('[data-parameter="subtitleSize"] input[type="range"]')
    slider.click(position={"x": 70, "y": 8})
    expect(slider).to_have_attribute("data-locked", "true")
    size = slider.input_value()
    canvas_text(page,"#preview canvas","Fuel economy by horsepower")
    expect(page.locator("#code-content")).to_contain_text('"subtitle": "Fuel economy by horsepower"')
    expect(page.locator("#current")).to_have_attribute("data-steps", "1")
    card.locator(".apply-button").click()
    expect(page.locator("#current")).to_have_attribute("data-steps", "2", timeout=60000)
    canvas_text(page,"#current canvas","Fuel economy by horsepower")
    canvas_text(page,"#current canvas","Fuel economy by horsepower",font_size=size)
    card = search(page, "editTitle")
    expect(card.locator('[data-parameter="subtitle"] input')).to_have_value("Fuel economy by horsepower")
    expect(card.locator('[data-parameter="subtitleSize"] input')).to_have_value(size)
    card.locator('[data-parameter="subtitle"] input').fill("")
    canvas_text(page,"#preview canvas","Fuel economy by horsepower",present=False)
    card.locator(".apply-button").click()
    expect(page.locator("#current")).to_have_attribute("data-steps", "3", timeout=60000)
    canvas_text(page,"#current canvas","Fuel economy by horsepower",present=False)
    assert not errors, errors
    print("PASS subtitle text/size preview, code, Apply, edit defaults and clearing; no weight controls")
    browser.close()
