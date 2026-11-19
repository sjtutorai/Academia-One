import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { db, generateId, handleFirestoreError, OperationType } from './firebase';

export async function recordAuditLog(params: {
  schoolId: string;
  actorUid: string;
  actorName: string;
  actorRole: string;
  action: string;
  targetType: string;
  targetId: string;
  targetLabel?: string;
  details?: string;
}): Promise<void> {
  const id = generateId('aud');
  const path = `auditLogs/${id}`;
  try {
    await setDoc(doc(db, 'auditLogs', id), {
      id,
      schoolId: params.schoolId || 'platform',
      actorUid: params.actorUid,
      actorName: params.actorName.slice(0, 120),
      actorRole: params.actorRole.slice(0, 32),
      action: params.action.slice(0, 120),
      targetType: params.targetType.slice(0, 64),
      targetId: params.targetId.slice(0, 128),
      targetLabel: (params.targetLabel || '').slice(0, 160),
      details: (params.details || '').slice(0, 500),
      createdAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, path);
  }
}
