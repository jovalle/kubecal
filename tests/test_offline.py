import unittest

from scripts.offline import rewrite


class OfflineImagesTest(unittest.TestCase):
    def test_missing_image_uses_placeholder_instead_of_dead_url(self):
        data = {"photo": "https://example.com/missing.jpg", "name": "Speaker"}
        self.assertEqual(rewrite(data, "photo", set())["photo"], "")


if __name__ == "__main__":
    unittest.main()
