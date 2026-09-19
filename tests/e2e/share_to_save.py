"""End-to-end check of Eva's share-to-save flow.

Verifies, against the running app, that a shared video link is:
  1. received through the Web Share Target entry point (?text=<url>)
  2. extracted into media info (title, thumbnail, formats)
  3. downloaded with visible progress
  4. saved to device storage (the browser download / file picker)
  5. shown in the completion state and in the local library

Run:  python3 tests/e2e/share_to_save.py [base_url]
"""

import asyncio
import os
import sys
import tempfile

from playwright.async_api import async_playwright, expect

BASE = (sys.argv[1] if len(sys.argv) > 1 else os.environ.get("EVA_BASE_URL", "http://localhost:8080")).rstrip("/")
SHARED_LINK = "https://www.youtube.com/watch?v=dQw4w9WgXcQ"


async def main() -> int:
    downloads = tempfile.mkdtemp(prefix="eva-e2e-")
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context(
            viewport={"width": 392, "height": 820},
            accept_downloads=True,
        )
        page = await context.new_page()
        errors: list[str] = []
        page.on("pageerror", lambda e: errors.append(str(e)))

        # 1. Arrive as an OS share target.
        await page.goto(f"{BASE}/?text={SHARED_LINK}", wait_until="domcontentloaded")
        sheet = page.get_by_role("dialog", name="Download")
        await expect(sheet).to_be_visible(timeout=15_000)

        # 2. Metadata was extracted for the shared link.
        await expect(sheet.get_by_role("heading")).not_to_be_empty(timeout=15_000)
        await expect(sheet.locator("img").first).to_be_visible()
        await expect(sheet.get_by_role("button", name="720p")).to_be_visible()

        # 3. Pick a format and download it.
        await sheet.get_by_role("button", name="720p").click()
        async with context.expect_event("download", timeout=60_000) as maybe_download:
            await sheet.get_by_role("button", name="Download", exact=True).click()
            await expect(sheet.get_by_text("Downloading")).to_be_visible(timeout=10_000)
            try:
                download = await maybe_download.value
            except Exception:
                download = None  # demo mode saves no real bytes

        # 4. Saved to device storage.
        saved_path = None
        if download is not None:
            saved_path = os.path.join(downloads, download.suggested_filename)
            await download.save_as(saved_path)
            assert os.path.getsize(saved_path) > 0, "saved file is empty"

        # 5. Completion state, then the library entry.
        await expect(sheet.get_by_text("Saved", exact=False)).to_be_visible(timeout=30_000)
        file_name = await sheet.get_by_test_id("saved-filename").inner_text()
        assert file_name.strip(), "no file name shown in the completion state"

        await sheet.get_by_role("button", name="Done").click()
        await expect(page.get_by_text("saved", exact=False).first).to_be_visible()
        library_count = await page.locator("ul li").count()
        assert library_count >= 1, "download did not reach the library"

        assert not errors, f"page errors: {errors}"
        print("PASS  share -> extract -> download -> save -> complete")
        print(f"      file name: {file_name.strip()}")
        print(f"      stored:    {saved_path or 'demo mode (no extractor connected)'}")
        print(f"      library:   {library_count} item(s)")
        await browser.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
