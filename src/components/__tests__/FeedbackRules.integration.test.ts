import { db } from '../../services/firebase';
import { collection, addDoc, getDocs, serverTimestamp } from 'firebase/firestore';
import { expect, test, describe } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('Firestore Security Rules Integration (Live Database)', () => {
  test('writing to a restricted collection fails', async () => {
    // Attempts to write to a collection that should be completely restricted
    const restrictedRef = collection(db, '_restricted_test_collection');
    
    await expect(
      addDoc(restrictedRef, {
        test: 'data',
        timestamp: new Date(),
      })
    ).rejects.toThrow(/insufficient permissions|permission-denied/i);
  });

  test('writing to feedback with invalid schema fails', async () => {
    const feedbackRef = collection(db, 'feedback');

    // Missing email and message fields (which are required by our rules)
    await expect(
      addDoc(feedbackRef, {
        name: 'Invalid Test',
        timestamp: serverTimestamp(),
      })
    ).rejects.toThrow(/insufficient permissions|permission-denied/i);
  });

  test('reading from feedback fails', async () => {
    const feedbackRef = collection(db, 'feedback');

    // Users should not be able to read feedback documents to preserve privacy
    await expect(
      getDocs(feedbackRef)
    ).rejects.toThrow(/insufficient permissions|permission-denied/i);
  });

  // Deployed rules now deny client creates on token_usage, matching
  // firestore.rules and the emulator test in src/test/firestore.rules.test.ts.
  test('writing valid token usage as a guest is denied', async () => {
    const tokenUsageRef = collection(db, 'token_usage');

    await expect(
      addDoc(tokenUsageRef, {
        userId: 'guest',
        model: 'gemini-2.5-pro',
        promptTokens: 100,
        completionTokens: 50,
        totalTokens: 150,
        feature: 'test-suite',
        timestamp: serverTimestamp(),
      })
    ).rejects.toThrow(/insufficient permissions|permission-denied/i);
  });

  test('writing token usage with invalid userId as unauthenticated user fails', async () => {
    const tokenUsageRef = collection(db, 'token_usage');
    
    await expect(
      addDoc(tokenUsageRef, {
        userId: 'some-fake-uid',
        model: 'gemini-2.5-pro',
        promptTokens: 100,
        completionTokens: 50,
        totalTokens: 150,
        feature: 'test-suite',
        timestamp: serverTimestamp(),
      })
    ).rejects.toThrow(/insufficient permissions|permission-denied/i);
  });

  test('writing token usage with missing schema fields fails', async () => {
    const tokenUsageRef = collection(db, 'token_usage');
    
    await expect(
      addDoc(tokenUsageRef, {
        userId: 'guest',
        model: 'gemini-2.5-pro',
        // missing promptTokens, completionTokens, totalTokens
        feature: 'test-suite',
        timestamp: serverTimestamp(),
      })
    ).rejects.toThrow(/insufficient permissions|permission-denied/i);
  }, 20000);

  test('reading token usage as unauthenticated user fails', async () => {
    const tokenUsageRef = collection(db, 'token_usage');
    
    await expect(
      getDocs(tokenUsageRef)
    ).rejects.toThrow(/insufficient permissions|permission-denied/i);
  });

  test('writing to feedback with valid schema succeeds', async () => {
    const feedbackRef = collection(db, 'feedback');

    const docRef = await addDoc(feedbackRef, {
      name: 'Valid integration test user',
      email: 'valid-test@example.com',
      message: 'Integration test message',
      createdAt: serverTimestamp(),
    });
    expect(docRef.id).toBeDefined();

    // Record the document ID for automated cleanup in global teardown
    const tempFilePath = path.resolve(process.cwd(), '.tmp-test-docs.json');
    let docIds: string[] = [];
    if (fs.existsSync(tempFilePath)) {
      try {
        const fileContent = fs.readFileSync(tempFilePath, 'utf8').trim();
        if (fileContent) {
          docIds = JSON.parse(fileContent);
        }
      } catch (err) {
        console.error('Failed to read temporary test documents file:', err);
      }
    }
    docIds.push(docRef.id);
    try {
      fs.writeFileSync(tempFilePath, JSON.stringify(docIds, null, 2));
    } catch (err) {
      console.error('Failed to write temporary test documents file:', err);
    }
  });
});
