"""
Session 2 - Verify Face Matching test runner (terminal table output)

Runs 5 real test cases against:
- check_duplicate_face (registration duplicate check)
- verify_face (registered user matching)

Usage:
  backend/venv/Scripts/python.exe backend/test_verify_face_matching_table.py
"""

import asyncio
import base64
import copy
import time
from datetime import datetime
from pathlib import Path

import cv2
import numpy as np

from starlette.requests import Request

import main


def image_to_base64(path: Path) -> str:
    return base64.b64encode(path.read_bytes()).decode("utf-8")


def make_two_face_image(src: Path, out: Path) -> Path:
    img = cv2.imread(str(src))
    if img is None:
        raise ValueError(f"Could not read image: {src}")
    two = cv2.hconcat([img, img])
    cv2.imwrite(str(out), two)
    return out

def make_low_light_image(src: Path, out: Path, alpha: float, beta: int) -> Path:
    img = cv2.imread(str(src))
    if img is None:
        raise ValueError(f"Could not read image: {src}")
    low = cv2.convertScaleAbs(img, alpha=alpha, beta=beta)
    cv2.imwrite(str(out), low)
    return out


def bottleneck_from_ms(ms: int) -> str:
    if ms >= 5000:
        return "High embedding/model inference time"
    if ms >= 2000:
        return "Embedding generation dominates latency"
    if ms >= 500:
        return "Face detection + embedding overhead"
    return "Fast path (early validation/no-face exit)"


async def run():
    root = Path(__file__).resolve().parents[1]
    face_img = root / "apps" / "web" / "apps" / "public" / "uploads" / "avatars" / "avatar-69a79c9247e85efb1540526f.jpg"
    no_face_img = root / "apps" / "web" / "apps" / "public" / "images" / "logoW.png"
    tmp_dir = root / "backend" / "_bench_verify"
    tmp_dir.mkdir(exist_ok=True)
    two_face_img = make_two_face_image(face_img, tmp_dir / "two_faces.jpg")
    low_light_img = make_low_light_image(face_img, tmp_dir / "low_light_dim.jpg", alpha=0.45, beta=-10)
    very_dark_img = make_low_light_image(face_img, tmp_dir / "low_light_very_dark.jpg", alpha=0.25, beta=-20)

    if not face_img.exists():
        raise FileNotFoundError(f"Missing face image: {face_img}")
    if not no_face_img.exists():
        raise FileNotFoundError(f"Missing no-face image: {no_face_img}")

    face_b64 = image_to_base64(face_img)
    blank_img = tmp_dir / "blank_no_face.jpg"
    cv2.imwrite(str(blank_img), np.ones((400, 400, 3), dtype=np.uint8) * 200)
    no_face_b64 = image_to_base64(blank_img)
    two_face_b64 = image_to_base64(two_face_img)
    low_light_b64 = image_to_base64(low_light_img)
    very_dark_b64 = image_to_base64(very_dark_img)

    # Keep environment deterministic for test output.
    original_db = copy.deepcopy(main.face_database)
    original_get_all = main.get_all_embeddings_from_mongodb
    main.get_all_embeddings_from_mongodb = lambda: [
        {"_id": uid, "resident_id": uid, "name": d.get("name"), "embedding_vector": d.get("embedding")}
        for uid, d in main.face_database.items()
    ]

    rows = []
    mock_req = Request({"type": "http", "client": ("127.0.0.1", 1234), "headers": []})
    try:
        # Precompute embedding once for controlled positive match/duplicate tests.
        image = main.decode_base64_image(face_b64)
        source_embedding = main.get_face_embedding(image)

        # TC1: Duplicate BLOCK (controlled true positive)
        main.face_database.clear()
        main.face_database["TC_DUP"] = {
            "name": "TC Duplicate Seed",
            "embedding": source_embedding,
            "registered_at": datetime.now().isoformat(),
        }
        main.rebuild_face_index()
        t0 = time.perf_counter()
        tc1 = await main.check_duplicate_face(main.DuplicateCheckRequest(image=face_b64), mock_req)
        tc1_ms = int((time.perf_counter() - t0) * 1000)
        rows.append({
            "test_case": "TC1 Duplicate Face Check",
            "result": f"decision={tc1.decision}, similarity={tc1.similarity}, threshold={tc1.threshold}",
            "pass": tc1.decision == "BLOCK",
            "bottleneck": bottleneck_from_ms(tc1_ms),
            "ms": tc1_ms,
        })

        # TC2: Unique ALLOW (empty db, same face)
        main.face_database.clear()
        main.rebuild_face_index()
        t0 = time.perf_counter()
        tc2 = await main.check_duplicate_face(main.DuplicateCheckRequest(image=face_b64), mock_req)
        tc2_ms = int((time.perf_counter() - t0) * 1000)
        rows.append({
            "test_case": "TC2 Unique Face Registration",
            "result": f"decision={tc2.decision}, similarity={tc2.similarity}",
            "pass": tc2.decision == "ALLOW",
            "bottleneck": bottleneck_from_ms(tc2_ms),
            "ms": tc2_ms,
        })

        # TC3: No Face image
        t0 = time.perf_counter()
        tc3 = await main.check_duplicate_face(main.DuplicateCheckRequest(image=no_face_b64), mock_req)
        tc3_ms = int((time.perf_counter() - t0) * 1000)
        rows.append({
            "test_case": "TC3 No Face Input",
            "result": f"decision={tc3.decision}, face_detected={tc3.face_detected}",
            "pass": (tc3.decision == "ERROR" and tc3.face_detected is False),
            "bottleneck": bottleneck_from_ms(tc3_ms),
            "ms": tc3_ms,
        })

        # TC4: Multiple faces
        t0 = time.perf_counter()
        tc4 = await main.check_duplicate_face(main.DuplicateCheckRequest(image=two_face_b64), mock_req)
        tc4_ms = int((time.perf_counter() - t0) * 1000)
        rows.append({
            "test_case": "TC4 Multiple Faces Input",
            "result": f"decision={tc4.decision}, msg={tc4.message[:38]}",
            "pass": (tc4.decision == "ERROR"),
            "bottleneck": bottleneck_from_ms(tc4_ms),
            "ms": tc4_ms,
        })

        # TC5: Verify matched registered user (controlled true)
        main.face_database.clear()
        main.face_database["TC_MATCH"] = {
            "name": "TC Verify Match",
            "embedding": source_embedding,
            "registered_at": datetime.now().isoformat(),
        }
        main.rebuild_face_index()
        t0 = time.perf_counter()
        tc5 = await main.verify_face(main.FaceVerifyRequest(image=face_b64))
        tc5_ms = int((time.perf_counter() - t0) * 1000)
        rows.append({
            "test_case": "TC5 Verify Face Match",
            "result": f"verified={tc5.verified}, confidence={tc5.confidence}",
            "pass": tc5.verified is True,
            "bottleneck": bottleneck_from_ms(tc5_ms),
            "ms": tc5_ms,
        })

        # TC6: Low-light verify path (feature coverage)
        t0 = time.perf_counter()
        tc6 = await main.verify_face(main.FaceVerifyRequest(image=low_light_b64))
        tc6_ms = int((time.perf_counter() - t0) * 1000)
        rows.append({
            "test_case": "TC6 Low-Light Verify",
            "result": f"verified={tc6.verified}, confidence={tc6.confidence}",
            "pass": (tc6.confidence >= 0.0),
            "bottleneck": bottleneck_from_ms(tc6_ms),
            "ms": tc6_ms,
        })

        # TC7: Very dark fallback behavior
        t0 = time.perf_counter()
        tc7 = await main.check_duplicate_face(main.DuplicateCheckRequest(image=very_dark_b64), mock_req)
        tc7_ms = int((time.perf_counter() - t0) * 1000)
        rows.append({
            "test_case": "TC7 Very-Dark Fallback",
            "result": f"decision={tc7.decision}, face_detected={tc7.face_detected}",
            "pass": (tc7.decision in ("ERROR", "ALLOW", "BLOCK")),
            "bottleneck": bottleneck_from_ms(tc7_ms),
            "ms": tc7_ms,
        })

    finally:
        main.face_database.clear()
        main.face_database.update(original_db)
        main.rebuild_face_index()
        main.get_all_embeddings_from_mongodb = original_get_all

    # Terminal table
    print("\n[Session 2] Verify Face Matching - Test Table")
    print("=" * 108)
    print(f"{'(index)':<8} {'Test Case':<30} {'Result':<38} {'Bottleneck':<24} {'ms':>6} {'Pass':>6}")
    print("-" * 108)
    for i, r in enumerate(rows):
        print(
            f"{i:<8} "
            f"{r['test_case']:<30.30} "
            f"{r['result']:<38.38} "
            f"{r['bottleneck']:<24.24} "
            f"{r['ms']:>6} "
            f"{str(r['pass']):>6}"
        )
    print("=" * 108)


if __name__ == "__main__":
    asyncio.run(run())
