"""Hover/parameter/Apply regressions against the running dev server (Playwright)."""
from playwright.sync_api import sync_playwright, expect
import re

with sync_playwright() as w:
    browser = w.chromium.launch(headless=True, executable_path="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")
    for reduced in ["no-preference", "reduce"]:
        context = browser.new_context(viewport={"width": 1600, "height": 1000}, reduced_motion=reduced)
        page = context.new_page()
        page.goto("http://127.0.0.1:5173/test/fixtures/card-motion.html")
        page.wait_for_load_state("networkidle")
        page.locator("#run").click()
        expect(page.locator("#report")).to_contain_text("PASS", timeout=15000)
        print(reduced, page.locator("#report").inner_text(), flush=True)
        context.close()

    for width, height in [(1440, 900), (2560, 1440)]:
        context = browser.new_context(viewport={"width": width, "height": height}, device_scale_factor=2)
        page = context.new_page()
        errors = []
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.goto("http://127.0.0.1:5173/")
        page.wait_for_load_state("networkidle")
        page.locator("#dataset").select_option(label="Iris")
        for field in ["Sepal.Width", "Petal.Width", "Species"]:
            page.get_by_role("button", name="Select column " + field, exact=True).click()
        card = page.locator(".card[data-method=createScatterPlot]")
        expect(card).to_be_visible(timeout=60000)
        card.locator(".card-top").hover()
        expect(card).to_have_class(re.compile(r"\bexpanded\b"))
        # Hover and clicking the card only preview; Apply alone changes history.
        card.locator(".card-top").click()
        assert page.locator("#current").get_attribute("data-steps") in [None, "0"]
        card.locator(".apply-button").click()
        expect(page.locator("#current")).to_have_attribute("data-steps", "1", timeout=60000)
        expect(page.locator(".card-row").first).to_have_attribute("aria-busy", "false", timeout=60000)
        page.mouse.move(1, 1)
        page.wait_for_timeout(350)
        # Mouse moves land on actual animated hit targets; no synthetic enter.
        for i in [0, 4, 1, 3, 2, 0, 4, 0]:
            box = page.locator(".card-row").first.locator(".card").nth(i).bounding_box()
            page.mouse.move(box["x"] + box["width"] / 2, box["y"] + 30)
            page.wait_for_timeout(65)
        page.wait_for_timeout(400)
        assert page.locator(".card.expanded").count() == 1
        assert page.locator(".card.expanded").get_attribute("data-position") == "1"
        assert page.locator("#current").get_attribute("data-steps") == "1"
        assert page.locator("#cards").evaluate("e => e.getAnimations({subtree:true}).filter(a => a.playState === 'running' || a.pending).length") == 0
        print("PASS rapid hover", width, height, flush=True)

        page.locator("#action-search").fill("encodeOpacity")
        expect(page.locator("#cards")).to_have_attribute("data-search-query", "encodeopacity", timeout=60000)
        card = page.locator(".card[data-method=encodeOpacity]")
        expect(card).to_be_visible(timeout=60000)
        card.locator(".card-top").hover()
        fixed = card.locator('[data-parameter="mode"] [data-value="fixed"]')
        if fixed.count():
            fixed.click()
        slider = card.locator('[data-parameter="value"] input[type="range"]')
        slider.hover(position={"x": 40, "y": 8})
        slider.click(position={"x": 60, "y": 8})
        expect(slider).to_have_attribute("data-locked", "true")
        value = slider.input_value()
        expect(page.locator("#code-content")).to_have_attribute("data-preview-method", "encodeOpacity", timeout=30000)
        card.locator(".apply-button").click()
        expect(page.locator("#current")).to_have_attribute("data-steps", "2", timeout=60000)
        expect(page.locator('#current canvas')).to_have_count(1)
        source = page.evaluate("async () => (await import('/web/code-view.js')).displayedCode(document.querySelector('#code-content'))")
        assert 'encodeOpacity' in source and f'"value": {value}' in source
        print("PASS slider hover, pin, code preview and Apply", width, height, flush=True)

        expect(page.locator(".card-row").first).to_have_attribute("aria-busy", "false", timeout=60000)
        page.locator(".card-row").first.locator(".card-top").first.hover()
        page.locator("#toggle-code").click()
        page.locator("#toggle-history").click()
        page.set_viewport_size({"width": width-100, "height": height-50})
        page.wait_for_timeout(400)
        assert page.locator("#cards").evaluate("e => e.getAnimations({subtree:true}).filter(a => a.playState === 'running' || a.pending).length") == 0
        page.locator("#group-style").click()
        expect(page.locator(".card-row").first).to_have_attribute("aria-busy", "false", timeout=60000)
        page.locator(".card-row").first.locator(".card-top").first.focus()
        page.keyboard.press("Tab")
        expect(page.locator(".card.expanded .apply-button")).to_be_focused()
        assert not errors, errors
        print("PASS panel resize, tab switch and keyboard Apply access", width, height, flush=True)
        context.close()
    browser.close()
