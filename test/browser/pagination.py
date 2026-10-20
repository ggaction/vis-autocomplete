"""Run with Playwright Python against the dev server at http://127.0.0.1:5173/."""
from playwright.sync_api import sync_playwright, expect


def visible_page(page):
    return page.locator("#cards").evaluate("""gallery => {
        const left = gallery.getBoundingClientRect().left;
        const rows = [...gallery.querySelectorAll('.card-row')];
        const row = rows.sort((a,b) => Math.abs(a.getBoundingClientRect().left-left)
          - Math.abs(b.getBoundingClientRect().left-left))[0];
        return {page: row?.dataset.page, ready: row?.getAttribute('aria-busy') === 'false',
          cards: row?.querySelectorAll('.card').length ?? 0};
    }""")


with sync_playwright() as p:
    browser = p.chromium.launch(
        headless=True, executable_path="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")
    context = browser.new_context(viewport={"width": 1600, "height": 1100})

    # Reproduce a slow later page deterministically without changing its result.
    def delay_later_pages(route):
        response = route.fetch()
        wrapper = """const sendResult = globalThis.postMessage.bind(globalThis);
globalThis.postMessage = message => message.value?.pagination?.page > 0
  ? setTimeout(() => sendResult(message), 450) : sendResult(message);
"""
        route.fulfill(response=response, body=wrapper + response.text())

    context.route("**/output/workers/calculation.js", delay_later_pages)
    page = context.new_page()
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.goto("http://127.0.0.1:5173/")
    page.wait_for_load_state("networkidle")
    page.locator("#dataset").select_option("barley")
    for field in ["site", "yield"]:
        page.get_by_role("button", name="Select column " + field, exact=True).click()
    for _ in range(14):
        if page.get_by_role("button", name="Preview Gradient plot", exact=True).count():
            break
        page.locator("#cards-next").click()
        page.wait_for_timeout(450)
    page.get_by_role("button", name="Preview Gradient plot", exact=True).hover()
    page.get_by_role("button", name="Use this chart: Gradient plot", exact=True).click()
    expect(page.locator("#history")).to_have_attribute("aria-busy", "false", timeout=30000)
    expect(page.locator("#cards-page")).to_have_text("1 / …")
    page.locator("#cards-next").click()
    page.locator("#group-style").click()
    page.locator("#group-encoding").click()
    expect(page.locator("#notice")).to_have_text("", timeout=60000)
    expect(page.locator("#cards-next")).to_be_enabled(timeout=60000)

    totals = {}
    for width, height in [(1600, 1100), (3226, 1200), (1600, 650)]:
        page.set_viewport_size({"width": width, "height": height})
        for group in ["encoding", "transform", "style"]:
            page.locator("#group-" + group).click()
            expect(page.locator("#notice")).to_have_text("", timeout=60000)
            for _ in range(20):
                page.wait_for_timeout(350)
                before = visible_page(page)
                assert before["ready"] and before["cards"] > 0, (group, before)
                if page.locator("#cards-next").is_disabled():
                    break
                assert before["cards"] == 5, (group, "A nonfinal page must contain five cards", before)
                page.locator("#cards-next").click()
                page.wait_for_timeout(350)
                # Navigation is immediate; expensive previews cannot lock Back.
                expect(page.locator("#cards-prev")).to_be_enabled()
                page.wait_for_function("""() => {
                  const gallery = document.querySelector('#cards'), left = gallery.getBoundingClientRect().left;
                  const row = [...gallery.children].sort((a,b) => Math.abs(a.getBoundingClientRect().left-left)
                    - Math.abs(b.getBoundingClientRect().left-left))[0];
                  return row?.getAttribute('aria-busy') === 'false';
                }""", timeout=60000)
            else:
                raise AssertionError("Pagination did not terminate")
            assert "…" not in page.locator("#cards-page").inner_text()
            total = int(page.locator("#cards-page").inner_text().split("/")[1])
            assert total == totals.setdefault(group, total), (group, totals, total)
            assert page.locator(".card-row[aria-busy='false']").count() == total
            print("PASS", width, height, group, page.locator("#cards-page").inner_text())

    # Restoring a cached deck must keep its validated pages and final count.
    page.locator("#group-encoding").click()
    expect(page.locator("#notice")).to_have_text("", timeout=30000)
    page.locator("#action-search").fill("opactiy")
    expect(page.locator("#cards")).to_have_attribute("data-search-query", "opactiy")
    expect(page.locator(".card[data-method='encodeOpacity']")).to_have_count(1, timeout=30000)
    page.locator("#action-search").fill("")
    expect(page.locator("#cards")).to_have_attribute("data-search-query", "")
    expect(page.locator("#notice")).to_have_text("", timeout=30000)
    page.wait_for_timeout(350)
    assert visible_page(page)["cards"] > 0
    assert not errors, errors
    browser.close()
