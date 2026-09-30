# Integration Guide: Duplicate Face Detection

This guide explains how to integrate the duplicate face detection into the registration flow.

## Files Created/Modified

### 1. New Files

| File | Purpose |
|------|---------|
| `docs/FACE_RECOGNITION_SYSTEM_DOCUMENTATION.md` | Comprehensive thesis documentation |
| `server/services/duplicateFaceService.ts` | Duplicate detection service |

### 2. Modified Files

| File | Changes |
|------|---------|
| `server/routes/faceRoutes.ts` | Added `/api/face/check-duplicate` endpoint |
| `server/models/Resident.ts` | Added `faceDescriptor` and `faceDescriptorMetadata` fields |
| `mobile/services/ai/FaceRecognitionService.ts` | Added `checkDuplicateFace()` method |

---

## Integration Steps

### Step 1: Update the Registration Flow

In `mobile/components/RegisterScreen.tsx`, update the `performVerificationAndSubmit` function:

```typescript
import { faceRecognitionService } from '../services/ai/FaceRecognitionService';

const performVerificationAndSubmit = async () => {
  if (!faceImage) {
    Alert.alert('Error', 'Please capture your face first');
    return;
  }

  setIsSubmitting(true);
  
  try {
    // ===== NEW: Check for duplicate face BEFORE submitting =====
    const duplicateCheck = await faceRecognitionService.checkDuplicateFace(faceImage);
    
    if (duplicateCheck.isDuplicate) {
      Alert.alert(
        'Already Registered',
        `This face is already registered under:\n\nName: ${duplicateCheck.existingResident?.name}\nBarangay: ${duplicateCheck.existingResident?.barangay}`,
        [{ text: 'OK' }]
      );
      setIsSubmitting(false);
      return;  // Stop registration
    }

    // ===== Continue with registration using the descriptor =====
    const registrationData = {
      // ... existing fields ...
      
      // Include the face descriptor for storage
      faceDescriptor: duplicateCheck.descriptor, // 512-float FaceNet vector
      faceDescriptorMetadata: {
        generatedAt: new Date().toISOString(),
        modelVersion: 'FaceNet-512-ONNX',
        confidence: duplicateCheck.confidence ?? 0.95,
      },
    };

    // Submit to server
    const response = await fetch(`${API_URL}/household/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(registrationData),
    });
    
    // ... handle response ...
    
  } catch (error) {
    console.error('Error:', error);
    Alert.alert('Error', 'Failed to verify face. Please try again.');
  } finally {
    setIsSubmitting(false);
  }
};
```

### Step 2: Update the Server Registration Endpoint

In your household registration route, add the descriptor to the resident record:

```typescript
// In householdRoutes.ts or residentRoutes.ts

router.post('/register', async (req, res) => {
  const {
    // ... other fields ...
    faceDescriptor,
    faceDescriptorMetadata,
  } = req.body;

  // Create resident with face descriptor
  const resident = new Resident({
    // ... other fields ...
    faceDescriptor,
    faceDescriptorMetadata,
  });

  await resident.save();
  
  // ...
});
```

---

## API Endpoints

### Check Duplicate Face

**POST** `/api/face/check-duplicate`

**Request:**
```json
{
  "image": "base64_encoded_image_string"
}
```

**Response (No Duplicate):**
```json
{
  "success": true,
  "isDuplicate": false,
  "message": "Face verified - no duplicate found",
  "descriptor": [0.012, -0.045, ...],  // 512-float normalized FaceNet vector
  "similarity": 0.28,
  "totalCompared": 150,
  "processingTime": 124
}
```

**Response (Duplicate Found - 409 Conflict):**
```json
{
  "success": false,
  "isDuplicate": true,
  "similarity": 0.912,
  "message": "This face is already registered in the system",
  "existingResident": {
    "id": "507f1f77bcf86cd799439011",
    "name": "Juan Dela Cruz",
    "barangay": "San Jose",
    "registeredAt": "2024-01-15T08:30:00.000Z"
  }
}
```

---

## Testing

### 1. Test Duplicate Detection

```bash
# First registration (should succeed)
curl -X POST https://kapit-bisig.onrender.com/api/face/check-duplicate \
  -H "Content-Type: application/json" \
  -d '{"image": "base64_encoded_face_1"}'

# Second registration with same face (should fail with 409)
curl -X POST https://kapit-bisig.onrender.com/api/face/check-duplicate \
  -H "Content-Type: application/json" \
  -d '{"image": "base64_encoded_face_1_different_photo"}'
```

### 2. Verify Threshold

The default threshold for duplicate detection is **0.85** (FaceNet Cosine Similarity):
- `backend/main.py`: `DUPLICATE_THRESHOLD = 0.85`
- `backend/main.py`: `FACE_MATCH_THRESHOLD = 0.65` (1:N verification)

---

## Performance Considerations

For large-scale deployment (>10,000 residents):

1. **Add Index to MongoDB:**
```javascript
// In MongoDB shell or migration
db.residents.createIndex({ "faceDescriptor": 1 });
```

2. **Consider Approximate Nearest Neighbor:**
For very large datasets, consider using:
- MongoDB Atlas Vector Search
- Elasticsearch with vector similarity
- Dedicated vector databases (Pinecone, Milvus)

3. **Batch Comparison:**
The current implementation compares sequentially. For better performance:
```javascript
// Use Promise.all for parallel comparison (if CPU permits)
const results = await Promise.all(
  existingResidents.map(r => compareDescriptors(newDescriptor, r.faceDescriptor))
);
```
