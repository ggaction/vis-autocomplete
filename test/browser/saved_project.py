"""Inspect the account-scoped saved project without a manual export control."""
import json
from pathlib import Path

READ_ACCOUNT_PROJECT = (Path(__file__).parent.parent / 'fixtures/read-account-project.js').read_text()


def read_saved_project(page):
    page.locator('.app-header h1').click()
    page.wait_for_function("document.querySelector('#cloud-status')?.textContent === 'Saved'")
    return page.evaluate(READ_ACCOUNT_PROJECT)


def save_project(page, path):
    Path(path).write_text(json.dumps(read_saved_project(page)))
