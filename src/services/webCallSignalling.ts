import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  type Unsubscribe,
} from 'firebase/firestore';
import { auth, db } from './firebase';

/** The small, validated message contract shared with the clay-map WebView. */
export type WebCallSignal = {
  type?: string;
  otherId?: unknown;
  callerName?: unknown;
  callId?: unknown;
  sdpType?: unknown;
  sdp?: unknown;
  candidate?: unknown;
  video?: unknown;
  requestId?: unknown;
};

type Emit = (message: Record<string, unknown>) => void;

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

/**
 * React Native's native-side Firestore relay for the clay-map WebView.
 *
 * The WebView owns getUserMedia, the peer connection, and the FaceTime tiles.
 * This class persists only the rendezvous, SDP, and ICE data, then injects the
 * same `poplurCall*` messages received by the iOS and Android WebViews. Its
 * `provider: "webrtc"` filter intentionally leaves RN's ordinary/native
 * voice-call work (and any future provider) untouched.
 */
export class NativeWebCallSignalling {
  private callUnsub: Unsubscribe | null = null;
  private candidateUnsub: Unsubscribe | null = null;
  private incomingUnsub: Unsubscribe | null = null;

  constructor(private readonly emit: Emit) {}

  handle(signal: WebCallSignal): void {
    switch (signal.type) {
      case 'callStart':
        void this.startCall(
          text(signal.otherId),
          text(signal.callerName) || undefined,
          signal.video === true,
          text(signal.requestId),
        );
        break;
      case 'callAccept':
        void this.acceptCall(text(signal.callId));
        break;
      case 'callDescription':
        void this.publishDescription(text(signal.callId), text(signal.sdpType) || 'offer', text(signal.sdp));
        break;
      case 'callCandidate':
        void this.publishCandidate(text(signal.callId), record(signal.candidate));
        break;
      case 'callEnd':
        void this.endCall(text(signal.callId));
        break;
      case 'callDecline':
        void this.declineCall(text(signal.callId));
        break;
      case 'callWatchIncoming':
        this.observeIncoming();
        break;
      default:
        break;
    }
  }

  stopAll(): void {
    this.stopObserving();
    this.incomingUnsub?.();
    this.incomingUnsub = null;
  }

  private async startCall(otherId: string, callerName: string | undefined, video: boolean, requestId: string): Promise<void> {
    const uid = auth.currentUser?.uid;
    if (!uid || !otherId || otherId === uid) {
      this.emit({ type: 'poplurCallStarted', callId: '', ok: false, requestId });
      return;
    }
    const ref = doc(collection(db, 'calls'));
    try {
      await setDoc(ref, {
        participants: [uid, otherId].sort(),
        callerId: uid,
        callerName: callerName || auth.currentUser?.displayName || 'Unknown',
        calleeId: otherId,
        status: 'ringing',
        // Media intent only. The browser turns it into camera tracks after
        // the receiver accepts; no media is stored in Firestore.
        video,
        createdAt: serverTimestamp(),
        provider: 'webrtc',
      });
      this.observe(ref.id);
      this.emit({ type: 'poplurCallStarted', callId: ref.id, ok: true, requestId });
    } catch (error) {
      console.warn('[NativeWebCallSignalling] could not open call', error);
      this.emit({ type: 'poplurCallStarted', callId: '', ok: false, requestId });
    }
  }

  private async publishDescription(callId: string, type: string, sdp: string): Promise<void> {
    if (!callId) return;
    const key = type === 'offer' ? 'offer' : 'answer';
    // startCall already marks the rendezvous as ringing. Keep a late offer
    // from regressing a call that the callee accepted in the meantime.
    const payload: Record<string, unknown> = { [key]: { type, sdp } };
    if (key === 'answer') payload.status = 'connected';
    try {
      await setDoc(
        doc(db, 'calls', callId),
        payload,
        { merge: true },
      );
    } catch (error) {
      console.warn('[NativeWebCallSignalling] publishDescription', error);
    }
  }

  private async publishCandidate(callId: string, candidate: Record<string, unknown>): Promise<void> {
    const uid = auth.currentUser?.uid;
    if (!uid || !callId) return;
    try {
      await setDoc(
        doc(collection(db, 'calls', callId, 'candidates')),
        { ...candidate, senderId: uid, createdAt: serverTimestamp() },
      );
    } catch (error) {
      console.warn('[NativeWebCallSignalling] publishCandidate', error);
    }
  }

  private async endCall(callId: string): Promise<void> {
    if (!callId) return;
    this.stopObserving();
    const ref = doc(db, 'calls', callId);
    try {
      await setDoc(ref, { status: 'ended' }, { merge: true });
      const candidates = await getDocs(collection(ref, 'candidates'));
      await Promise.all(candidates.docs.map(candidate => deleteDoc(candidate.ref)));
      await deleteDoc(ref);
    } catch (error) {
      // A racing far-side cleanup is harmless. Keep the page responsive.
      console.warn('[NativeWebCallSignalling] endCall', error);
    }
  }

  private async declineCall(callId: string): Promise<void> {
    if (!callId) return;
    try {
      await updateDoc(doc(db, 'calls', callId), { status: 'declined' });
    } catch (error) {
      console.warn('[NativeWebCallSignalling] declineCall', error);
    }
  }

  private async acceptCall(callId: string): Promise<void> {
    if (!callId) return;
    this.observe(callId);
    try {
      await updateDoc(doc(db, 'calls', callId), { status: 'connected' });
    } catch (error) {
      console.warn('[NativeWebCallSignalling] acceptCall', error);
    }
  }

  private observe(callId: string): void {
    this.stopObserving();
    const uid = auth.currentUser?.uid;
    if (!uid || !callId) return;
    const ref = doc(db, 'calls', callId);

    this.callUnsub = onSnapshot(ref, snapshot => {
      const data = snapshot.data();
      if (!data) {
        this.emit({ type: 'poplurCallEnded', callId });
        this.stopObserving();
        return;
      }
      const status = text(data.status);
      if (status === 'ended' || status === 'declined') {
        this.emit({ type: 'poplurCallEnded', callId, reason: status });
        this.stopObserving();
        return;
      }
      const wanted = data.callerId === uid ? 'answer' : 'offer';
      const description = record(data[wanted]);
      const sdp = text(description.sdp);
      if (sdp) {
        this.emit({
          type: 'poplurCallDescription',
          callId,
          sdpType: text(description.type) || wanted,
          sdp,
        });
      }
    });

    this.candidateUnsub = onSnapshot(collection(ref, 'candidates'), snapshot => {
      snapshot.docChanges().forEach(change => {
        if (change.type !== 'added') return;
        const candidate = { ...change.doc.data() } as Record<string, unknown>;
        if (candidate.senderId === uid) return;
        delete candidate.senderId;
        delete candidate.createdAt;
        this.emit({ type: 'poplurCallCandidate', callId, candidate });
      });
    });
  }

  private observeIncoming(): void {
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    this.incomingUnsub?.();
    this.incomingUnsub = onSnapshot(
      query(
        collection(db, 'calls'),
        where('calleeId', '==', uid),
        where('status', '==', 'ringing'),
      ),
      snapshot => {
        snapshot.docChanges().forEach(change => {
          if (change.type === 'removed') {
            this.emit({ type: 'poplurCallIncomingUnavailable', callId: change.doc.id });
            return;
          }
          if (change.type !== 'added') return;
          const data = change.doc.data();
          if (data.provider !== 'webrtc') return;
          this.emit({
            type: 'poplurCallIncoming',
            callId: change.doc.id,
            callerId: text(data.callerId),
            callerName: text(data.callerName) || 'Unknown',
            video: data.video === true,
          });
        });
      },
      error => console.warn('[NativeWebCallSignalling] observeIncoming', error),
    );
  }

  private stopObserving(): void {
    this.callUnsub?.();
    this.callUnsub = null;
    this.candidateUnsub?.();
    this.candidateUnsub = null;
  }
}
