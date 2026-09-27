"""
Unit tests for Continuous Live Stream 3D Liveness Evaluation
"""

import numpy as np
import unittest
from unittest.mock import patch
from services.active_liveness_service import active_liveness_verifier


class TestLiveStreamLiveness(unittest.TestCase):
    def setUp(self):
        self.patcher = patch('services.active_liveness_service.liveness_detector.predict')
        self.mock_predict = self.patcher.start()
        self.mock_predict.return_value = (True, 0.95, {"attack_type": "none", "live_score": 0.95})

        self.dummy_img = np.zeros((400, 400, 3), dtype=np.uint8)
        self.f_data = {
            'bbox': [100, 80, 200, 240],
            'left_eye': (165, 175),
            'right_eye': (235, 175),
            'nose': (200, 190),
            'chin': (200, 270),
            'mouth_left': (175, 250),
            'mouth_right': (225, 250)
        }
        self.right_data = {
            'bbox': [100, 80, 200, 240],
            'left_eye': (155, 175),
            'right_eye': (215, 175),
            'nose': (200, 190),
            'chin': (200, 270),
            'mouth_left': (170, 250),
            'mouth_right': (220, 250)
        }
        self.left_data = {
            'bbox': [100, 80, 200, 240],
            'left_eye': (185, 175),
            'right_eye': (245, 175),
            'nose': (200, 190),
            'chin': (200, 270),
            'mouth_left': (180, 250),
            'mouth_right': (230, 250)
        }
        self.nod_data = {
            'bbox': [100, 80, 200, 240],
            'left_eye': (165, 215),
            'right_eye': (235, 215),
            'nose': (200, 230),
            'chin': (200, 290),
            'mouth_left': (175, 270),
            'mouth_right': (225, 270)
        }
        self.trans_data = {
            'bbox': [150, 80, 200, 240],
            'left_eye': (215, 175),
            'right_eye': (285, 175),
            'nose': (250, 190),
            'chin': (250, 270),
            'mouth_left': (225, 250),
            'mouth_right': (275, 250)
        }

    def tearDown(self):
        self.patcher.stop()

    def test_live_stream_happy_path(self):
        """Simulate live stream: align frontal -> lock -> turn head -> pass"""
        sess = "test_happy_path_1"
        with patch.object(active_liveness_verifier, 'detect_face_and_eyes', return_value=self.f_data):
            r1 = active_liveness_verifier.evaluate_live_stream_frame(sess, "frontal", self.dummy_img, reset_session=True)
            self.assertEqual(r1["status"], "ALIGNING")
            r2 = active_liveness_verifier.evaluate_live_stream_frame(sess, "frontal", self.dummy_img)
            self.assertEqual(r2["status"], "FRONTAL_LOCKED")
            self.assertEqual(r2["progress"], 0.50)
            self.assertEqual(r2["stage"], "turn")

        with patch.object(active_liveness_verifier, 'detect_face_and_eyes', return_value=self.right_data):
            r3 = active_liveness_verifier.evaluate_live_stream_frame(sess, "turn", self.dummy_img)
            self.assertEqual(r3["status"], "PASSED")
            self.assertEqual(r3["progress"], 1.0)
            self.assertTrue(r3["is_live"])

    def test_live_stream_turn_left_accepted(self):
        """Turning head left is accepted as valid rotation in direction-agnostic mode"""
        sess = "test_left_pass_1"
        with patch.object(active_liveness_verifier, 'detect_face_and_eyes', return_value=self.f_data):
            active_liveness_verifier.evaluate_live_stream_frame(sess, "frontal", self.dummy_img, reset_session=True)
            active_liveness_verifier.evaluate_live_stream_frame(sess, "frontal", self.dummy_img)

        with patch.object(active_liveness_verifier, 'detect_face_and_eyes', return_value=self.left_data):
            r = active_liveness_verifier.evaluate_live_stream_frame(sess, "turn", self.dummy_img)
            self.assertEqual(r["status"], "PASSED")
            self.assertEqual(r["progress"], 1.0)
            self.assertTrue(r["is_live"])

    def test_live_stream_nodding_accepted(self):
        """Vertical nod is accepted as a valid 3D head motion"""
        sess = "test_nod_1"
        with patch.object(active_liveness_verifier, 'detect_face_and_eyes', return_value=self.f_data):
            active_liveness_verifier.evaluate_live_stream_frame(sess, "frontal", self.dummy_img, reset_session=True)
            active_liveness_verifier.evaluate_live_stream_frame(sess, "frontal", self.dummy_img)

        with patch.object(active_liveness_verifier, 'detect_face_and_eyes', return_value=self.nod_data):
            r = active_liveness_verifier.evaluate_live_stream_frame(sess, "turn", self.dummy_img)
            self.assertEqual(r["status"], "PASSED")
            self.assertTrue(r["is_live"])

    def test_live_stream_phone_translation_blocked(self):
        """Translating camera sideways without face rotation should not pass rotation check"""
        sess = "test_trans_1"
        with patch.object(active_liveness_verifier, 'detect_face_and_eyes', return_value=self.f_data):
            active_liveness_verifier.evaluate_live_stream_frame(sess, "frontal", self.dummy_img, reset_session=True)
            active_liveness_verifier.evaluate_live_stream_frame(sess, "frontal", self.dummy_img)

        with patch.object(active_liveness_verifier, 'detect_face_and_eyes', return_value=self.trans_data):
            r = active_liveness_verifier.evaluate_live_stream_frame(sess, "turn", self.dummy_img)
            self.assertNotEqual(r["status"], "PASSED")
            self.assertFalse(r.get("is_live", False))
            self.assertIn("Keep phone steady", r["feedback"])


if __name__ == "__main__":
    print("Running Live Stream Liveness unit tests...")
    suite = unittest.TestLoader().loadTestsFromTestCase(TestLiveStreamLiveness)
    runner = unittest.TextTestRunner(verbosity=2)
    result = runner.run(suite)
    assert result.wasSuccessful(), "Live stream unit tests failed!"
    print("All Live Stream unit tests passed successfully!")
