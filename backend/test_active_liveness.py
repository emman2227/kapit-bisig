"""
Unit tests for Active 3D Challenge-Response Liveness
"""

import cv2
import numpy as np
import unittest
from services.active_liveness_service import active_liveness_verifier


class TestActiveLiveness(unittest.TestCase):
    def setUp(self):
        # Create synthetic test faces
        self.frontal_img = np.zeros((400, 400, 3), dtype=np.uint8)
        # Face skin ellipse
        cv2.ellipse(self.frontal_img, (200, 200), (90, 120), 0, 0, 360, (180, 190, 230), -1)
        # Eyes
        cv2.circle(self.frontal_img, (165, 175), 10, (50, 40, 30), -1)
        cv2.circle(self.frontal_img, (235, 175), 10, (50, 40, 30), -1)
        # Nose
        cv2.line(self.frontal_img, (200, 185), (200, 220), (120, 130, 170), 3)
        # Mouth
        cv2.ellipse(self.frontal_img, (200, 255), (30, 10), 0, 0, 180, (80, 80, 180), -1)

    def test_static_identical_frames_rejected(self):
        """Testing with identical photo (static tablet spoof) should fail"""
        res = active_liveness_verifier.verify_active_liveness(
            self.frontal_img,
            self.frontal_img.copy(),
            challenge_type="turn_right"
        )
        self.assertTrue(res["success"])
        self.assertFalse(res["is_live"], "Static identical photo should be rejected")
        self.assertEqual(res["status"], "REJECTED")
        self.assertIn("No head rotation detected", res["message"])

    def test_genuine_motion_detected(self):
        """Testing with rotated head should detect significant yaw/symmetry delta"""
        turned_img = np.zeros((400, 400, 3), dtype=np.uint8)
        cv2.ellipse(turned_img, (200, 200), (90, 120), 0, 0, 360, (180, 190, 230), -1)
        cv2.circle(turned_img, (185, 175), 12, (0, 0, 0), -1)
        cv2.circle(turned_img, (255, 175), 12, (0, 0, 0), -1)

        f1_data = active_liveness_verifier.detect_face_and_eyes(self.frontal_img)
        f2_data = active_liveness_verifier.detect_face_and_eyes(turned_img)
        self.assertIsNotNone(f1_data)
        self.assertIsNotNone(f2_data)

        y1, _, _ = active_liveness_verifier.estimate_head_pose(f1_data)
        y2, _, _ = active_liveness_verifier.estimate_head_pose(f2_data)
        yaw_delta = abs(y2 - y1)
        sym1 = active_liveness_verifier.compute_facial_symmetry_ratio(f1_data)
        sym2 = active_liveness_verifier.compute_facial_symmetry_ratio(f2_data)
        sym_delta = abs(sym2 - sym1)

        self.assertGreater(yaw_delta + sym_delta * 10, 5.0, "Should detect genuine 3D movement delta")

    def test_excessive_head_turn_guidance(self):
        """Testing with empty/lost face in challenge frame should return helpful guidance"""
        blank_challenge = np.zeros((400, 400, 3), dtype=np.uint8)
        res = active_liveness_verifier.verify_active_liveness(
            self.frontal_img,
            blank_challenge,
            challenge_type="turn_right"
        )
        self.assertFalse(res["is_live"])
        self.assertEqual(res["status"], "REJECTED")
        self.assertIn("turn your head slightly", res["message"])

    def test_frozen_user_rejected(self):
        """3.3: User not moving / holding still between frames should be rejected"""
        # Slight noise/jitter applied to identical face
        jittered = self.frontal_img.copy()
        noise = np.random.randint(-3, 3, jittered.shape, dtype=np.int16)
        jittered = np.clip(jittered.astype(np.int16) + noise, 0, 255).astype(np.uint8)

        res = active_liveness_verifier.verify_active_liveness(
            self.frontal_img,
            jittered,
            challenge_type="turn_right"
        )
        self.assertFalse(res["is_live"], "Frozen user frame should be rejected")
        self.assertEqual(res["status"], "REJECTED")
        self.assertIn("No head rotation detected", res["message"])

    def test_nodding_accepted(self):
        """Vertical nodding is accepted as a valid 3D head rotation"""
        from unittest.mock import patch
        nodded_img = np.zeros((400, 400, 3), dtype=np.uint8)
        cv2.ellipse(nodded_img, (200, 220), (90, 105), 0, 0, 360, (180, 190, 230), -1)
        cv2.circle(nodded_img, (165, 195), 10, (50, 40, 30), -1)
        cv2.circle(nodded_img, (235, 195), 10, (50, 40, 30), -1)
        cv2.line(nodded_img, (200, 205), (200, 240), (120, 130, 170), 3)
        cv2.ellipse(nodded_img, (200, 270), (30, 8), 0, 0, 180, (80, 80, 180), -1)

        with patch('services.active_liveness_service.liveness_detector.predict', return_value=(True, 0.95, {"live_score": 0.95})), \
             patch.object(active_liveness_verifier, 'compute_face_similarity', return_value=0.78):
            res = active_liveness_verifier.verify_active_liveness(
                self.frontal_img,
                nodded_img,
                challenge_type="turn_any"
            )
            self.assertTrue(res["is_live"], "Vertical nodding should be accepted as 3D movement")
            self.assertEqual(res["status"], "PASSED")

    def test_phone_translation_rejected(self):
        """3.5: Translating camera sideways instead of rotating head should be rejected"""
        # Translate whole image horizontally by 50px
        M = np.array([[1, 0, 50], [0, 1, 0]], dtype=np.float32)
        shifted = cv2.warpAffine(self.frontal_img, M, (400, 400))

        res = active_liveness_verifier.verify_active_liveness(
            self.frontal_img,
            shifted,
            challenge_type="turn_right"
        )
        self.assertFalse(res["is_live"], "Phone lateral translation should be rejected")
        self.assertEqual(res["status"], "REJECTED")

    def test_any_turn_direction_accepted(self):
        """Direction is agnostic — turning in either direction is not rejected by directional checks"""
        from unittest.mock import patch
        turned_left = np.zeros((400, 400, 3), dtype=np.uint8)
        cv2.ellipse(turned_left, (200, 200), (90, 120), 0, 0, 360, (180, 190, 230), -1)
        cv2.circle(turned_left, (145, 175), 10, (50, 40, 30), -1)
        cv2.circle(turned_left, (215, 175), 10, (50, 40, 30), -1)
        cv2.line(turned_left, (180, 185), (180, 220), (120, 130, 170), 3)

        with patch('services.active_liveness_service.liveness_detector.predict', return_value=(True, 0.95, {"live_score": 0.95})):
            res = active_liveness_verifier.verify_active_liveness(
                self.frontal_img,
                turned_left,
                challenge_type="turn_any"
            )
            # Direction enforcement removed: should never complain about turning wrong direction
            self.assertNotIn("You turned", res.get("message", ""))

    def test_left_profile_accepted(self):
        """Any profile turn (left or right) confirms 3D head rotation and is accepted"""
        from unittest.mock import patch
        orig_fn = active_liveness_verifier.detect_profile_face
        active_liveness_verifier.detect_profile_face = lambda image: ([100, 100, 150, 150], "left")
        try:
            with patch('services.active_liveness_service.liveness_detector.predict', return_value=(True, 0.95, {"live_score": 0.95})):
                blank = np.zeros((400, 400, 3), dtype=np.uint8)
                res = active_liveness_verifier.verify_active_liveness(
                    self.frontal_img,
                    blank,
                    challenge_type="turn_any"
                )
                self.assertTrue(res["is_live"], "Profile turn in either direction should be accepted")
                self.assertEqual(res["status"], "PASSED")
        finally:
            active_liveness_verifier.detect_profile_face = orig_fn


if __name__ == "__main__":
    print("Running Active Liveness tests...")
    suite = unittest.TestLoader().loadTestsFromTestCase(TestActiveLiveness)
    runner = unittest.TextTestRunner(verbosity=2)
    result = runner.run(suite)
    assert result.wasSuccessful(), "Active Liveness unit tests failed!"
    print("All Active Liveness unit tests passed successfully!")
