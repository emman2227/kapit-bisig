"""
Face Duplicate Testing Utility
==============================
Use this script to test ALLOW and BLOCK scenarios without needing other people.

Commands:
  python test_face_duplicate.py list          - List all registered faces
  python test_face_duplicate.py clear         - Clear all face embeddings (fresh start)
  python test_face_duplicate.py clear-logs    - Clear registration logs
  python test_face_duplicate.py add-dummy     - Add dummy test faces for BLOCK testing
  python test_face_duplicate.py reset         - Full reset (clear everything)
"""

import sys
import os
if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass
from dotenv import load_dotenv
from pymongo import MongoClient
from datetime import datetime
import numpy as np

load_dotenv()

MONGODB_URI = os.getenv("MONGODB_URI")
client = MongoClient(MONGODB_URI)
db = client["kapit-bisig"]

def list_faces():
    """List all registered face embeddings"""
    faces = list(db.face_embeddings.find({}, {"embedding_vector": 0}))
    print(f"\n{'='*60}")
    print(f"  REGISTERED FACES: {len(faces)}")
    print(f"{'='*60}")
    
    if not faces:
        print("  No faces registered yet.")
    else:
        for i, face in enumerate(faces, 1):
            print(f"\n  [{i}] {face.get('name', 'Unknown')}")
            print(f"      ID: {face.get('resident_id', 'N/A')}")
            print(f"      Barangay: {face.get('barangay', 'N/A')}")
            print(f"      Created: {face.get('created_at', 'N/A')}")
    
    print(f"\n{'='*60}\n")

def list_logs():
    """List recent registration logs"""
    logs = list(db.face_registration_logs.find().sort("timestamp", -1).limit(10))
    print(f"\n{'='*60}")
    print(f"  RECENT REGISTRATION LOGS: {len(logs)}")
    print(f"{'='*60}")
    
    for log in logs:
        decision = log.get('decision', 'N/A')
        color_code = '✅' if decision == 'ALLOW' else '🚫' if decision == 'BLOCK' else '⚠️'
        print(f"\n  {color_code} {decision}")
        print(f"      Time: {log.get('timestamp', 'N/A')}")
        print(f"      Best Match: {log.get('best_match_name', 'None')}")
        print(f"      Similarity: {log.get('similarity', 0):.2f}")
        print(f"      Processing: {log.get('processing_time_ms', 0)} ms")
    
    print(f"\n{'='*60}\n")

def clear_faces():
    """Clear all face embeddings"""
    result = db.face_embeddings.delete_many({})
    print(f"\n✅ Cleared {result.deleted_count} face embeddings.")
    print("   You can now register again as a 'new' user!\n")

def clear_logs():
    """Clear all registration logs"""
    result = db.face_registration_logs.delete_many({})
    print(f"\n✅ Cleared {result.deleted_count} registration logs.\n")

def add_dummy_faces():
    """Add dummy test faces to simulate existing registrations"""
    dummy_faces = [
        {
            "resident_id": "DUMMY_001",
            "first_name": "Juan",
            "last_name": "Dela Cruz",
            "name": "Juan Dela Cruz",
            "date_of_birth": "1990-01-15",
            "gender": "Male",
            "mobile_number": "09171234567",
            "barangay": "San Jose",
            "street_address": "123 Sample Street",
            "embedding_vector": np.random.randn(128).tolist(),  # Random embedding
            "face_image_path": "dummy",
            "created_at": datetime.now()
        },
        {
            "resident_id": "DUMMY_002",
            "first_name": "Maria",
            "last_name": "Santos",
            "name": "Maria Santos",
            "date_of_birth": "1985-06-20",
            "gender": "Female",
            "mobile_number": "09181234567",
            "barangay": "Poblacion",
            "street_address": "456 Test Avenue",
            "embedding_vector": np.random.randn(128).tolist(),
            "face_image_path": "dummy",
            "created_at": datetime.now()
        },
        {
            "resident_id": "DUMMY_003",
            "first_name": "Pedro",
            "last_name": "Garcia",
            "name": "Pedro Garcia",
            "date_of_birth": "1978-12-01",
            "gender": "Male",
            "mobile_number": "09191234567",
            "barangay": "Bolo",
            "street_address": "789 Demo Road",
            "embedding_vector": np.random.randn(128).tolist(),
            "face_image_path": "dummy",
            "created_at": datetime.now()
        }
    ]
    
    result = db.face_embeddings.insert_many(dummy_faces)
    print(f"\n✅ Added {len(result.inserted_ids)} dummy test faces:")
    for face in dummy_faces:
        print(f"   - {face['name']} ({face['barangay']})")
    print("\n   Note: These have random embeddings, so they won't match your face.")
    print("   Your face will still be ALLOW (unique) unless you register twice.\n")

def copy_my_face():
    """Copy your existing face embedding as a 'different person' to test BLOCK"""
    existing = db.face_embeddings.find_one({"resident_id": {"$not": {"$regex": "^DUPLICATE_"}}})
    
    if not existing:
        print("\n❌ No existing face found. Register first, then run this command.\n")
        return
    
    duplicate = {
        "resident_id": f"DUPLICATE_{datetime.now().strftime('%H%M%S')}",
        "first_name": "Test",
        "last_name": "Duplicate",
        "name": "Test Duplicate (Your Face Copy)",
        "date_of_birth": "2000-01-01",
        "gender": existing.get("gender", "Unknown"),
        "mobile_number": "09001234567",
        "barangay": existing.get("barangay", "San Jose"),
        "street_address": "Test Address",
        "embedding_vector": existing["embedding_vector"],  # Copy YOUR embedding!
        "face_image_path": "copied_for_testing",
        "created_at": datetime.now()
    }
    
    result = db.face_embeddings.insert_one(duplicate)
    print(f"\n✅ Created a DUPLICATE of your face embedding!")
    print(f"   Original: {existing.get('name', 'Unknown')}")
    print(f"   Copy ID: {duplicate['resident_id']}")
    print(f"\n   Now if you try to register again with your face,")
    print(f"   it should show: BLOCK (Duplicate)\n")

def full_reset():
    """Full reset - clear everything"""
    clear_faces()
    clear_logs()
    print("🔄 Full reset complete. Database is fresh for testing.\n")

def show_help():
    print(__doc__)

if __name__ == "__main__":
    if len(sys.argv) < 2:
        show_help()
        list_faces()
        list_logs()
        sys.exit(0)
    
    command = sys.argv[1].lower()
    
    if command == "list":
        list_faces()
        list_logs()
    elif command == "clear":
        clear_faces()
    elif command == "clear-logs":
        clear_logs()
    elif command == "add-dummy":
        add_dummy_faces()
    elif command == "copy-my-face":
        copy_my_face()
    elif command == "reset":
        full_reset()
    elif command == "help":
        show_help()
    else:
        print(f"Unknown command: {command}")
        show_help()
