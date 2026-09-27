"""
Test suite for Deep-Learning ID Verification (RapidOCR + Face-on-ID)
"""

import base64
import cv2
import numpy as np
from services.id_verification_service import id_verifier

def test_id_with_keywords_and_id_number():
    # Synthetic card
    img = np.ones((300, 480, 3), dtype=np.uint8) * 245
    cv2.putText(img, "REPUBLIKA NG PILIPINAS", (30, 40), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 0, 0), 2)
    cv2.putText(img, "PHILIPPINE IDENTIFICATION CARD", (30, 80), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 0, 0), 2)
    cv2.putText(img, "ID: 9876-5432-1098-7654", (30, 130), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 0, 0), 2)

    res = id_verifier.verify_document(img, expected_id_number="9876-5432-1098-7654")
    assert res["is_valid_id"] is True, f"Expected valid ID, got {res}"
    assert res["id_number_matched"] is True
    assert "REPUBLIKA NG PILIPINAS" in res["detected_keywords"]
    assert res["aspect_ratio_valid"] is True

def test_random_document_without_id_signals_rejected():
    # Random text document (e.g. receipt or grocery list)
    img = np.ones((600, 300, 3), dtype=np.uint8) * 255  # Vertical receipt
    cv2.putText(img, "SUPERMARKET RECEIPT", (20, 50), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 0, 0), 2)
    cv2.putText(img, "TOTAL: PHP 500.00", (20, 100), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 0, 0), 2)
    cv2.putText(img, "THANK YOU COME AGAIN", (20, 150), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 0, 0), 2)

    res = id_verifier.verify_document(img)
    assert res["is_valid_id"] is False, f"Receipt should be rejected as valid ID: {res}"
    assert len(res["detected_keywords"]) == 0
    assert res["has_portrait_face"] is False

if __name__ == "__main__":
    print("Running ID verification tests...")
    test_id_with_keywords_and_id_number()
    print("PASS: test_id_with_keywords_and_id_number")
    test_random_document_without_id_signals_rejected()
    print("PASS: test_random_document_without_id_signals_rejected")
    print("All ID verification tests passed successfully!")
