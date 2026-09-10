import json
import re
import subprocess
import tempfile
import unittest
from pathlib import Path


class SitemapDatasetFreshnessTest(unittest.TestCase):
    def setUp(self):
        self.repo = Path(__file__).resolve().parents[1]

    @staticmethod
    def lastmod(sitemap: str, url: str) -> str:
        match = re.search(
            rf"<url><loc>{re.escape(url)}</loc><lastmod>(\d{{4}}-\d{{2}}-\d{{2}})</lastmod>",
            sitemap,
        )
        if not match:
            raise AssertionError(f"URL sitemap assente: {url}")
        return match.group(1)

    def test_production_sitemap_uses_the_correct_dataset_for_each_daily_page(self):
        catalog = json.loads((self.repo / "public/data/offerte-arera-menu.json").read_text(encoding="utf-8"))
        energy = json.loads((self.repo / "public/data/energia-oggi.json").read_text(encoding="utf-8"))
        sitemap = (self.repo / "public/sitemap.xml").read_text(encoding="utf-8")
        catalog_date = str(catalog["aggiornatoIl"])

        self.assertEqual(
            self.lastmod(sitemap, "https://offertalogica.it/offerte-luce-gas-aggiornate.html"),
            catalog_date,
        )
        provider_urls = re.findall(
            r"<loc>(https://offertalogica\.it/fornitori/[^<]+\.html)</loc>",
            sitemap,
        )
        self.assertTrue(provider_urls)
        for url in provider_urls:
            self.assertEqual(self.lastmod(sitemap, url), catalog_date)

        self.assertEqual(
            self.lastmod(sitemap, "https://offertalogica.it/pun-oggi.html"),
            str(energy["pun"]["data"]),
        )
        self.assertEqual(
            self.lastmod(sitemap, "https://offertalogica.it/psv-gas-oggi.html"),
            str(energy["gas"]["giornaliero"]["data"]),
        )

        offers = (self.repo / "public/offerte-luce-gas-aggiornate.html").read_text(encoding="utf-8")
        self.assertRegex(offers, rf'"dateModified"\s*:\s*"{re.escape(catalog_date)}"')

    def test_helper_updates_catalog_pages_without_overwriting_energy_or_other_daily_pages(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "public/data").mkdir(parents=True)
            (root / "public/data/offerte-arera-menu.json").write_text(
                json.dumps({"aggiornatoIl": "2026-11-14", "offerte": [{}, {}, {}]}),
                encoding="utf-8",
            )
            (root / "public/sitemap.xml").write_text(
                """<?xml version="1.0" encoding="UTF-8"?>
<urlset>
  <url><loc>https://offertalogica.it/offerte-luce-gas-aggiornate.html</loc><lastmod>2026-10-01</lastmod><changefreq>daily</changefreq></url>
  <url><loc>https://offertalogica.it/fornitori/enel.html</loc><lastmod>2026-10-01</lastmod><changefreq>daily</changefreq></url>
  <url><loc>https://offertalogica.it/pun-oggi.html</loc><lastmod>2026-11-13</lastmod><changefreq>daily</changefreq></url>
  <url><loc>https://offertalogica.it/psv-gas-oggi.html</loc><lastmod>2026-11-12</lastmod><changefreq>daily</changefreq></url>
  <url><loc>https://offertalogica.it/altro-daily.html</loc><lastmod>2026-09-30</lastmod><changefreq>daily</changefreq></url>
  <url><loc>https://offertalogica.it/monthly.html</loc><lastmod>2026-06-25</lastmod><changefreq>monthly</changefreq></url>
</urlset>
""",
                encoding="utf-8",
            )
            (root / "public/offerte-luce-gas-aggiornate.html").write_text(
                '<script type="application/ld+json">{"dateModified":"2026-10-01"}</script>'
                '<div class="notice" id="arera-update-note"><strong>Vecchio testo.</strong></div>',
                encoding="utf-8",
            )

            subprocess.run(
                ["python3", str(self.repo / "scripts/update-sitemap-lastmod.py"), "--root", str(root)],
                check=True,
                capture_output=True,
                text=True,
            )
            sitemap = (root / "public/sitemap.xml").read_text(encoding="utf-8")
            self.assertEqual(
                self.lastmod(sitemap, "https://offertalogica.it/offerte-luce-gas-aggiornate.html"),
                "2026-11-14",
            )
            self.assertEqual(
                self.lastmod(sitemap, "https://offertalogica.it/fornitori/enel.html"),
                "2026-11-14",
            )
            self.assertEqual(self.lastmod(sitemap, "https://offertalogica.it/pun-oggi.html"), "2026-11-13")
            self.assertEqual(self.lastmod(sitemap, "https://offertalogica.it/psv-gas-oggi.html"), "2026-11-12")
            self.assertEqual(self.lastmod(sitemap, "https://offertalogica.it/altro-daily.html"), "2026-09-30")
            self.assertEqual(self.lastmod(sitemap, "https://offertalogica.it/monthly.html"), "2026-06-25")

            offers = (root / "public/offerte-luce-gas-aggiornate.html").read_text(encoding="utf-8")
            self.assertIn('"dateModified":"2026-11-14"', offers)
            self.assertIn("Dati ARERA aggiornati al 14/11/2026", offers)
            self.assertIn("usa 3 offerte censite", offers)

    def test_local_updater_includes_catalog_page_in_sync_backup_and_final_validation(self):
        shell = (self.repo / "scripts/aggiorna-arera-locale-mac.sh").read_text(encoding="utf-8")
        self.assertIn('python3 "$ROOT_DIR/scripts/update-sitemap-lastmod.py" --root "$ROOT_DIR"', shell)
        self.assertGreaterEqual(shell.count("public/offerte-luce-gas-aggiornate.html"), 4)
        self.assertIn("Verifico la coerenza SEO tra dataset, pagine e sitemap", shell)
        self.assertIn("lastmod PUN sovrascritto da un dataset diverso", shell)
        self.assertIn('log "- public/offerte-luce-gas-aggiornate.html"', shell)

    def test_github_publisher_includes_catalog_page_in_all_publish_stages(self):
        shell = (self.repo / "scripts/pubblica-arera-github.sh").read_text(encoding="utf-8")
        self.assertIn("PUBLISH_FILES=(", shell)
        self.assertEqual(shell.count('"public/offerte-luce-gas-aggiornate.html"'), 1)
        self.assertEqual(
            shell.count('for relative_path in "${PUBLISH_FILES[@]}"; do'),
            3,
        )
        self.assertIn(
            'git -C "$REPO_DIR" add -- "${PUBLISH_FILES[@]}"',
            shell,
        )
        self.assertIn(
            'python3 "$REPO_DIR/test/update_sitemap_lastmod_test.py"',
            shell,
        )

    def test_github_workflow_only_validates_offline_and_does_not_acquire_or_publish_data(self):
        workflow = (self.repo / ".github/workflows/update-arera-menu.yml").read_text(encoding="utf-8")
        self.assertIn("name: Verifica dati OffertaLogica", workflow)
        self.assertIn("contents: read", workflow)
        self.assertIn("python test/update_sitemap_lastmod_test.py", workflow)
        self.assertNotIn("cron:", workflow)
        self.assertNotIn("python scripts/update-energy-today.py", workflow)
        self.assertNotIn("git push", workflow)


if __name__ == "__main__":
    unittest.main()
