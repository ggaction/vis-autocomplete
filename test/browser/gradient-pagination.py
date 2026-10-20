"""Regression: restored Barley variety/yield/variety, after editing both scales."""
import json
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

root = Path(__file__).resolve().parents[2]
snapshot = json.loads((root / "test/fixtures/barley-gradient-pagination.json").read_text())
project = {"format": "visualization-autocomplete", "version": 1, "activeId": "barley",
           "datasets": [{"id": "barley", "name": "Barley",
                         "imported": {"rows": json.loads((root / "web/data/barley.json").read_text())},
                         "session": {"index": 0, "entries": [snapshot]}}]}

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True,
        executable_path="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")
    context = browser.new_context(viewport={"width": 3226, "height": 1200})
    def delay_later_pages(route):
        response = route.fetch()
        wrapper = """const sendResult = globalThis.postMessage.bind(globalThis);
globalThis.postMessage = message => message.value?.pagination?.page > 0
  ? setTimeout(() => sendResult(message), 3000) : sendResult(message);
"""
        route.fulfill(response=response, body=wrapper + response.text())
    context.route("**/output/workers/calculation.js", delay_later_pages)
    page = context.new_page()
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.goto("http://127.0.0.1:5173/")
    page.wait_for_load_state("networkidle")
    page.locator("#project-file").set_input_files({
        "name": "barley-gradient.visauto", "mimeType": "application/json",
        "buffer": json.dumps(project).encode()})
    expect(page.locator("#current")).to_have_attribute("data-last-method", "editYScale")
    expect(page.locator(".card-row[aria-busy='false']")).to_have_count(1, timeout=30000)
    expect(page.locator("#cards-next")).to_be_enabled()
    page.locator("#cards-next").click()
    expect(page.locator("#cards-page")).to_have_text("2 / …", timeout=1500)
    expect(page.locator("#cards-prev")).to_be_enabled()
    # No all-gallery lock, and finishing a request must not drag us forward again.
    page.locator("#cards-prev").click()
    expect(page.locator("#cards-page")).to_have_text("1 / …", timeout=1500)
    expect(page.locator(".card-row[data-page='2']")).to_have_attribute("aria-busy", "false", timeout=30000)
    assert page.locator("#cards-page").inner_text().startswith("1 /")
    for group in ["encoding", "transform", "style"]:
        page.locator("#group-" + group).click()
        expect(page.locator("#notice")).to_have_text("", timeout=30000)
        for _ in range(12):
            page.wait_for_timeout(350)
            current = int(page.locator("#cards-page").inner_text().split("/")[0])
            row = page.locator(f".card-row[data-page='{current}']")
            expect(row).to_have_attribute("aria-busy", "false", timeout=30000)
            assert row.locator(".card").count() > 0
            if page.locator("#cards-next").is_disabled():
                break
            page.locator("#cards-next").click()
        else:
            raise AssertionError("Pagination did not terminate")
        assert "…" not in page.locator("#cards-page").inner_text()
        print("PASS restored gradient", group, page.locator("#cards-page").inner_text())
    assert not errors, errors
    (root / "output").mkdir(exist_ok=True)
    page.locator("#group-encoding").click()
    expect(page.locator("#notice")).to_have_text("")
    page.wait_for_timeout(350)  # Let the 280 ms card appearance finish.
    page.screenshot(path=str(root / "output/gradient-pagination-fixed.png"))
    browser.close()
