import tempfile
import unittest
from pathlib import Path

from scripts.slides import name_for, valid


class SlideCacheTest(unittest.TestCase):
    def test_names_are_stable_distinct_and_reject_other_hosts(self):
        first = "https://sessionize.com/download/a~slides.pdf"
        self.assertEqual(name_for(first), name_for(first))
        self.assertTrue(name_for(first).endswith("-slides.pdf"))
        self.assertNotEqual(name_for(first), name_for(first.replace("/a~", "/b~")))
        with self.assertRaises(ValueError):
            name_for("https://example.com/slides.pdf")

    def test_rejects_bad_signature(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "slides.pdf"
            path.write_bytes(b"not a PDF")
            self.assertFalse(valid(path))
            path.write_bytes(b"%PDF-1.7")
            self.assertTrue(valid(path))


if __name__ == "__main__":
    unittest.main()
