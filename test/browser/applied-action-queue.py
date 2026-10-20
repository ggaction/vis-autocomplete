"""Used cards stay discoverable and reusable through real UI paging and search."""
import re
from playwright.sync_api import sync_playwright, expect


def settled(page):
    expect(page.locator(".card-row").first).to_have_attribute("aria-busy", "false", timeout=60000)
    page.mouse.move(1, 1)


def search(page, method):
    page.locator("#action-search").fill(method)
    expect(page.locator("#cards")).to_have_attribute("data-search-query", method.lower(), timeout=60000)
    settled(page)
    card = page.locator(f".card[data-method={method}]")
    expect(card).to_have_count(1)
    card.locator(".card-top").hover()
    return card


def apply(page, card, steps):
    card.locator(".apply-button").click()
    expect(page.locator("#current")).to_have_attribute("data-steps", str(steps), timeout=60000)
    settled(page)


def tail(page, method):
    page.locator("#action-search").fill("")
    expect(page.locator("#cards")).to_have_attribute("data-search-query", "", timeout=60000)
    settled(page)
    for _ in range(20):
        number = int(page.locator("#cards-page").inner_text().split("/")[0])
        row = page.locator(f'.card-row[data-page="{number}"]')
        expect(row).to_have_attribute("aria-busy", "false", timeout=60000)
        assert row.locator(".card").count() > 0, "An empty page must not be advertised"
        if page.locator("#cards-next").is_disabled():
            break
        page.locator("#cards-next").click()
        expect(page.locator("#cards-page")).to_have_text(re.compile(rf"^{number + 1} /"), timeout=60000)
    else:
        raise AssertionError("Pagination did not terminate")
    assert "…" not in page.locator("#cards-page").inner_text()
    expect(row.locator(".card").last).to_have_attribute("data-method", method)
    assert page.locator(f".card[data-method={method}]").count() == 1
    card = row.locator(f".card[data-method={method}]")
    card.locator(".card-top").hover()
    expect(card.locator(".apply-button")).to_be_enabled()
    return card


with sync_playwright() as p:
    browser = p.chromium.launch(
        headless=True, executable_path="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")
    context = browser.new_context(viewport={"width": 1600, "height": 1100})
    page = context.new_page()
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.goto("http://127.0.0.1:5173/")
    page.wait_for_load_state("networkidle")
    page.locator("#dataset").select_option(label="Iris")
    for field in ["Sepal.Width", "Petal.Width", "Species"]:
        page.get_by_role("button", name="Select column " + field, exact=True).click()
    scatter = page.locator(".card[data-method=createScatterPlot]")
    expect(scatter).to_be_visible(timeout=60000)
    scatter.locator(".card-top").hover()
    apply(page, scatter, 1)

    apply(page, search(page, "encodeShape"), 2)
    card = tail(page, "encodeShape")
    expect(card).to_have_attribute("data-preview-state", "unchanged")
    expect(card.locator(".thumbnail svg")).to_have_count(1)
    assert card.locator(".needs-adjustment").count() == 0
    card.locator(".apply-button").click()
    expect(page.locator("#notice")).to_have_text("These settings are already applied.", timeout=30000)
    expect(page.locator("#current")).to_have_attribute("data-steps", "2")
    expect(page.locator("#cards")).not_to_have_attribute("aria-busy", "true")
    print("PASS unchanged Shape remains at tail with thumbnail; Apply does not duplicate history", flush=True)
    card = search(page, "encodeShape")
    expect(card).to_have_attribute("data-preview-state", "unchanged")
    print("PASS used Shape remains searchable", flush=True)

    apply(page, search(page, "encodeOpacity"), 3)
    card = tail(page, "encodeOpacity")
    card.locator('[data-parameter="mode"] [data-value="fixed"]').click()
    slider = card.locator('[data-parameter="value"] input[type="range"]')
    slider.click(position={"x": 55, "y": 8})
    expect(slider).to_have_attribute("data-locked", "true")
    value = slider.input_value()
    expect(card).to_have_attribute("data-preview-state", "ready", timeout=30000)
    apply(page, card, 4)
    assert page.locator(f'#current svg [opacity="{value}"]').count() > 0
    tail(page, "encodeOpacity")
    page.locator("#undo").click()
    expect(page.locator("#current")).to_have_attribute("data-steps", "3", timeout=60000)
    settled(page)
    tail(page, "encodeOpacity")
    page.locator("#redo").click()
    expect(page.locator("#current")).to_have_attribute("data-steps", "4", timeout=60000)
    settled(page)
    tail(page, "encodeOpacity")
    print("PASS tail action parameter changes, reapply, Undo and Redo", flush=True)

    for group, creator, editor, steps in [
        ("style", "createTitle", "editTitle", 5),
        ("transform", "createRegression", "editRegression", 6),
    ]:
        page.locator("#action-search").fill("")
        expect(page.locator("#cards")).to_have_attribute("data-search-query", "", timeout=60000)
        page.locator("#group-" + group).click()
        settled(page)
        apply(page, search(page, creator), steps)
        tail(page, editor)
        search(page, editor)
        print("PASS", creator, "becomes", editor, "at tail and in search", flush=True)
    assert not errors, errors
    context.close()
    browser.close()
