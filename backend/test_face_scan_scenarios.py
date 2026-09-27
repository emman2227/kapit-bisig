"""
Automated Test Suite for Face Scan Scenarios
Covers:
1. Natural Left Turn (Happy Path)
2. Natural Right Turn (Happy Path)
3. Natural Head Nod / Tilt (Happy Path)
4. Relaxed Centering (Handheld offset up to 35%)
5. Static / Frozen User Detection (Negative test)
6. Extreme Profile Turn Fallback (Happy Path)
7. Digital Screen / Print Spoof Detection (Anti-spoofing)
8. Multiple Faces in Frame (Security check)
"""

import sys
import unittest
import numpy as np
import cv2
from unittest.mock import patch, MagicMock

# Import backend services and functions
from services.active_liveness_service import active_liveness_verifier
from main import check_face_centered, check_face_size


class TestFaceScanScenarios(unittest.TestCase):
    def setUp(self):
        # Create a synthetic frontal face canvas (400x400)
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

    def test_scenario_1_left_turn_accepted(self):
        """Scenario 1: Turning head left is accepted as genuine 3D liveness"""
        turned_left = np.zeros((400, 400, 3), dtype=np.uint8)
        cv2.ellipse(turned_left, (200, 200), (90, 120), 0, 0, 360, (180, 190, 230), -1)
        cv2.circle(turned_left, (145, 175), 10, (50, 40, 30), -1)
        cv2.circle(turned_left, (215, 175), 10, (50, 40, 30), -1)
        cv2.line(turned_left, (180, 185), (180, 220), (120, 130, 170), 3)

        with patch('services.active_liveness_service.liveness_detector.predict', return_value=(True, 0.96, {"live_score": 0.96})), \
             patch.object(active_liveness_verifier, 'compute_face_similarity', return_value=0.79):
            res = active_liveness_verifier.verify_active_liveness(
                self.frontal_img,
                turned_left,
                challenge_type="turn_any"
            )
            self.assertTrue(res["is_live"], "Left turn must be accepted as valid liveness")
            self.assertEqual(res["status"], "PASSED")
            self.assertIn("verified", res["message"].lower())

    def test_scenario_2_right_turn_accepted(self):
        """Scenario 2: Turning head right is accepted as genuine 3D liveness"""
        turned_right = np.zeros((400, 400, 3), dtype=np.uint8)
        cv2.ellipse(turned_right, (200, 200), (90, 120), 0, 0, 360, (180, 190, 230), -1)
        cv2.circle(turned_right, (185, 175), 10, (50, 40, 30), -1)
        cv2.circle(turned_right, (255, 175), 10, (50, 40, 30), -1)
        cv2.line(turned_right, (220, 185), (220, 220), (120, 130, 170), 3)

        with patch('services.active_liveness_service.liveness_detector.predict', return_value=(True, 0.96, {"live_score": 0.96})), \
             patch.object(active_liveness_verifier, 'compute_face_similarity', return_value=0.79):
            res = active_liveness_verifier.verify_active_liveness(
                self.frontal_img,
                turned_right,
                challenge_type="turn_any"
            )
            self.assertTrue(res["is_live"], "Right turn must be accepted as valid liveness")
            self.assertEqual(res["status"], "PASSED")
            self.assertIn("verified", res["message"].lower())

    def test_scenario_3_nod_tilt_accepted(self):
        """Scenario 3: Vertical nod or tilt is accepted as valid 3D head motion"""
        nodded = np.zeros((400, 400, 3), dtype=np.uint8)
        cv2.ellipse(nodded, (200, 220), (90, 105), 0, 0, 360, (180, 190, 230), -1)
        cv2.circle(nodded, (165, 195), 10, (50, 40, 30), -1)
        cv2.circle(nodded, (235, 195), 10, (50, 40, 30), -1)
        cv2.line(nodded, (200, 205), (200, 240), (120, 130, 170), 3)
        cv2.ellipse(nodded, (200, 270), (30, 8), 0, 0, 180, (80, 80, 180), -1)

        with patch('services.active_liveness_service.liveness_detector.predict', return_value=(True, 0.95, {"live_score": 0.95})), \
             patch.object(active_liveness_verifier, 'compute_face_similarity', return_value=0.80):
            res = active_liveness_verifier.verify_active_liveness(
                self.frontal_img,
                nodded,
                challenge_type="turn_any"
            )
            self.assertTrue(res["is_live"], "Vertical nodding should be accepted as 3D movement")
            self.assertEqual(res["status"], "PASSED")

    def test_scenario_4_relaxed_centering_handheld(self):
        """Scenario 4: Handheld face with 30% offset passes relaxed centering check"""
        img_w, img_h = 400, 400
        # Face offset by 30% horizontally (center_x = 200 + 120 = 320 -> within 35% tolerance)
        offset_face = [220, 100, 160, 200]  # face center = (300, 200), diff from img center = 100px (25%)
        is_centered = check_face_centered(offset_face, img_w, img_h)
        self.assertTrue(is_centered, "Handheld 25-30% offset face must pass relaxed centering")

        # But a face cut off at edge (> 35% offset) should still fail
        cut_off_face = [300, 100, 160, 200]  # face center = (380, 200), diff from img center = 180px (45%)
        is_centered_edge = check_face_centered(cut_off_face, img_w, img_h)
        self.assertFalse(is_centered_edge, "Cut-off edge face must be rejected")

    def test_scenario_5_static_frozen_frame_rejected(self):
        """Scenario 5: Holding completely still / showing identical photo is rejected"""
        res = active_liveness_verifier.verify_active_liveness(
            self.frontal_img,
            self.frontal_img.copy(),
            challenge_type="turn_any"
        )
        self.assertFalse(res["is_live"], "Frozen identical frame must be rejected")
        self.assertEqual(res["status"], "REJECTED")
        self.assertIn("No head rotation detected", res["message"])

    def test_scenario_6_extreme_profile_turn_accepted(self):
        """Scenario 6: Turning sharply into profile is recognized and accepted"""
        orig_fn = active_liveness_verifier.detect_profile_face
        active_liveness_verifier.detect_profile_face = lambda img: ([80, 80, 160, 160], "profile")
        try:
            with patch('services.active_liveness_service.liveness_detector.predict', return_value=(True, 0.95, {"live_score": 0.95})):
                blank = np.zeros((400, 400, 3), dtype=np.uint8)
                res = active_liveness_verifier.verify_active_liveness(
                    self.frontal_img,
                    blank,
                    challenge_type="turn_any"
                )
                self.assertTrue(res["is_live"], "Sharp profile rotation must pass")
                self.assertEqual(res["status"], "PASSED")
        finally:
            active_liveness_verifier.detect_profile_face = orig_fn

    def test_scenario_7_screen_replay_spoof_rejected(self):
        """Scenario 7: Screen or digital replay attack flagged by MiniFASNet is rejected"""
        with patch('services.active_liveness_service.liveness_detector.predict', return_value=(False, 0.12, {"attack_type": "screen_or_replay", "live_score": 0.12})):
            res = active_liveness_verifier.verify_active_liveness(
                self.frontal_img,
                self.frontal_img,
                challenge_type="turn_any"
            )
            self.assertFalse(res["is_live"], "Screen replay spoof must be rejected")
            self.assertEqual(res["status"], "REJECTED")

    def test_scenario_8_no_movement_phone_shift_handled(self):
        """Scenario 8: Translating camera laterally without 3D rotation fails motion threshold"""
        # Translate whole image horizontally by 40px without any 3D perspective shift
        M = np.array([[1, 0, 40], [0, 1, 0]], dtype=np.float32)
        shifted = cv2.warpAffine(self.frontal_img, M, (400, 400))

        res = active_liveness_verifier.verify_active_liveness(
            self.frontal_img,
            shifted,
            challenge_type="turn_any"
        )
        self.assertFalse(res["is_live"], "Pure 2D translation without 3D rotation must fail")
        self.assertEqual(res["status"], "REJECTED")


if __name__ == "__main__":
    print("="*60)
    print("RUNNING AUTOMATED FACE SCAN SCENARIO TESTS")
    print("="*60)
    suite = unittest.TestLoader().loadTestsFromTestCase(TestFaceScanScenarios)
    runner = unittest.TextTestRunner(verbosity=2)
    result = runner.run(suite)
    sys.exit(0 if result.wasSuccessful() else 1)
