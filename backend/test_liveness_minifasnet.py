"""
Test suite for MiniFASNet Passive Anti-Spoofing
Verifies model loading, inference, and spoof detection behavior.
"""

import os
import cv2
import numpy as np
from services.liveness_service import liveness_detector

def test_model_loaded():
    assert liveness_detector.is_loaded is True, "MiniFASNet model should be loaded"
    assert liveness_detector.session is not None, "ONNX InferenceSession should not be None"

def test_closeup_selfie_confirmed():
    """A close-up selfie filling most of the camera frame should pass without false-positive spoofing."""
    img_path = os.path.join(os.path.dirname(__file__), "_bench_lowlight", "normal.jpg")
    if not os.path.exists(img_path):
        return
    img = cv2.imread(img_path)
    # Simulate tight close-up selfie
    x, y, w, h = 535, 745, 239, 239
    cx, cy = x + w/2, y + h/2
    sim_selfie = img[int(cy - 300):int(cy + 300), int(cx - 170):int(cx + 170)]
    sim_bbox = [50, 180, 239, 239]
    is_real, score, details = liveness_detector.predict(sim_selfie, sim_bbox)
    assert is_real is True, f"Close-up selfie should pass liveness (score={score}, details={details})"
    assert score >= 0.80, f"Close-up selfie score should be >= 0.80, got {score}"

def test_screen_like_flat_pixels_rejected():
    """Flat uniform digital pixel grid should be rejected."""
    screen_like = np.zeros((400, 400, 3), dtype=np.uint8)
    # Add regular grid lines (like screen pixels)
    screen_like[::4, :] = 255
    screen_like[:, ::4] = 255
    bbox = [100, 100, 200, 200]
    is_real, score, details = liveness_detector.predict(screen_like, bbox)
    assert is_real is False, "Synthetic screen pattern should be rejected"

def test_real_face_confirmed():
    """Real camera photo of a human face should pass with high live confidence."""
    img_path = os.path.join(os.path.dirname(__file__), "_bench_lowlight", "normal.jpg")
    if not os.path.exists(img_path):
        return
    img = cv2.imread(img_path)
    # Bounding box of face in normal.jpg
    bbox = [535, 745, 239, 239]
    is_real, score, details = liveness_detector.predict(img, bbox)
    assert is_real is True, f"Real face should pass liveness (score={score}, details={details})"
    assert score >= 0.80, f"Real face score should be >= 0.80, got {score}"
    assert details["predicted_class"] == 1, f"Predicted class should be 1 (Live), got {details['predicted_class']}"

if __name__ == "__main__":
    print("Running MiniFASNet tests...")
    test_model_loaded()
    print("PASS: test_model_loaded")
    test_closeup_selfie_confirmed()
    print("PASS: test_closeup_selfie_confirmed")
    test_screen_like_flat_pixels_rejected()
    print("PASS: test_screen_like_flat_pixels_rejected")
    test_real_face_confirmed()
    print("PASS: test_real_face_confirmed")
    print("All MiniFASNet tests passed successfully!")
