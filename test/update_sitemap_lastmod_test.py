import json
import subprocess
import tempfile
import unittest
from pathlib import Path
import re
import shutil


class SitemapAreraC3Test(unittest.TestCase):
    def setUp(self):
        self.repo = Path(__file__).resolve().parents[1]

    def test_production_sitemap_daily_dates_match_current_catalog(self):
        catalog = json.loads((self.repo / "public/data/offerte-arera-menu.json").read_text(encoding="utf-8")) if (self.repo / "public/data/offerte-arera-menu.json").exists() else {"aggiornatoIl": "2026-08-13"}
        as_of = catalog.get("aggiornatoIl", "2026-08-13")
        sitemap = (self.repo / "public/sitemap.xml").read_text(encoding="utf-8")
        blocks = re.findall(r"<url>.*?</url>", sitemap, flags=re.S)
        daily = [block for block in blocks if "<changefreq>daily</changefreq>" in block]
        self.assertTrue(daily)
        for block in daily:
            self.assertIn(f"<lastmod>{as_of}</lastmod>", block)

    def test_helper_updates_only_daily_entries(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "public/data").mkdir(parents=True)
            (root / "public").mkdir(exist_ok=True)
            (root / "public/data/offerte-arera-menu.json").write_text(
                json.dumps({"aggiornatoIl": "2026-08-14"}),
                encoding="utf-8",
            )
            (root / "public/sitemap.xml").write_text(
                """<?xml version="1.0" encoding="UTF-8"?>
<urlset>
  <url><loc>daily</loc><lastmod>2026-07-13</lastmod><changefreq>daily</changefreq></url>
  <url><loc>monthly</loc><lastmod>2026-06-25</lastmod><changefreq>monthly</changefreq></url>
</urlset>
""",
                encoding="utf-8",
            )
            subprocess.run(
                ["python3", str(self.repo / "scripts/update-sitemap-lastmod.py"), "--root", str(root)],
                check=True,
                capture_output=True,
                text=True,
            )
            result = (root / "public/sitemap.xml").read_text(encoding="utf-8")
            self.assertIn("<loc>daily</loc><lastmod>2026-08-14</lastmod>", result)
            self.assertIn("<loc>monthly</loc><lastmod>2026-06-25</lastmod>", result)

    def test_local_updater_calls_helper_after_successful_catalog_publish(self):
        shell = (self.repo / "scripts/aggiorna-arera-locale-mac.sh").read_text(encoding="utf-8")
        self.assertIn('python3 "$ROOT_DIR/scripts/update-sitemap-lastmod.py" --root "$ROOT_DIR"', shell)
        self.assertIn('log "- public/sitemap.xml"', shell)

    def test_workflow_updates_and_commits_sitemap(self):
        workflow = (self.repo / ".github/workflows/update-arera-menu.yml").read_text(encoding="utf-8")
        self.assertIn("run: python scripts/update-sitemap-lastmod.py", workflow)
        self.assertIn("public/sitemap.xml", workflow)


if __name__ == "__main__":
    unittest.main()
