// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import {
  CollectionReference,
  DocumentReference,
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  onSnapshot,
  query,
  setDoc,
  where,
} from "firebase/firestore";
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyB1wUl4ZcZ952raQlVfDkai8rABctx00VA",
  authDomain: "resonant-rock-376300.firebaseapp.com",
  projectId: "resonant-rock-376300",
  storageBucket: "resonant-rock-376300.appspot.com",
  messagingSenderId: "504674438089",
  appId: "1:504674438089:web:a4bf32a447a88534b4f618",
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
// Initialize Cloud Firestore and get a reference to the service
const db = getFirestore(app);

const urlParams = new URLSearchParams(window.location.search);

const UUID = generateUUID();
let localStream: MediaStream;
const videoContainer = "#video-section";

const PEER_CONFIG = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    {
      urls: "turn:openrelay.metered.ca:80",
      username: "openrelayproject",
      credential: "openrelayproject",
    },
  ],
};

const CLIENTS: PeerClient[] = [];

const openMediaDevices = async (constraints: any) => {
  return await navigator.mediaDevices.getUserMedia(constraints);
};

async function start() {
  if (urlParams.get("room") == undefined) {
    alert("Error: No room ID given!");
    return;
  }
  const roomID = urlParams.get("room") ?? "";
  $("#room-code").text("Room code: " + roomID);

  try {
    localStream = await openMediaDevices({ video: true, audio: true });
    $("#mute-btn").click(() => {
      localStream.getAudioTracks()[0].enabled =
        !localStream.getAudioTracks()[0].enabled;

      $("#mute-btn").text(
        localStream.getAudioTracks()[0].enabled ? "Mute" : "Unmute"
      );
    });
  } catch (error) {
    alert(
      "Error: Could not open media device! Please check device and refresh."
    );
    return;
  }

  (document.getElementById("localstream") as HTMLVideoElement).srcObject =
    localStream;

  const roomRef = doc(db, `rooms`, roomID);
  const clientRef = doc(db, `${roomRef.path}/clients`, UUID);

  // Setup client doc and heartbeat
  await setDoc(clientRef, { id: UUID, heartbeat: Date.now() });
  setInterval(
    () => setDoc(clientRef, { heartbeat: Date.now() }, { merge: true }),
    2000
  );

  // Remove dead clients
  setInterval(() => {
    console.log("Checking for dead peers");
    for (const client of CLIENTS) {
      if (!client.isAlive) {
        console.log("Peer dead!");
        client.close();
        let index = CLIENTS.indexOf(client);
        CLIENTS.splice(index, 1);
      }
    }
  }, 1000);

  setupSnapshots(
    collection(db, `${clientRef.path}/ReceivedICE`),
    collection(db, `${clientRef.path}/ReceivedOffers`),
    collection(db, `${clientRef.path}/ReceivedAnswers`),
    roomRef
  );

  // Send offers to clients
  const q = query(
    collection(db, `${roomRef.path}/clients`),
    where("id", "<", UUID)
  );
  const docs = await getDocs(q);

  docs.forEach((doc) => {
    if (Date.now() - doc.data().heartbeat > 5000) {
      return;
    }
    // if(doc.data().id = )
    console.log(`Adding client ${doc.data().id}`);
    let client = new PeerClient(doc.data().id, doc.ref);
    CLIENTS.push(client);
    client.makeOffer();
  });
}

// Generate id from unix epoch and 4 digit random number
function generateUUID() {
  return Date.now().toString() + Math.floor(Math.random() * 10000).toString();
}

class PeerClient {
  id: number;
  isAlive: boolean;
  check_heartbeat: any;
  conn: RTCPeerConnection;

  offerRef: CollectionReference;
  answerRef: CollectionReference;
  iceRef: CollectionReference;

  constructor(id: number, docRef: DocumentReference) {
    this.id = id;
    this.isAlive = true;
    this.conn = new RTCPeerConnection(PEER_CONFIG);

    this.conn.onicecandidate = (event) => {
      if (event.candidate) {
        this.sendIce(event.candidate);
      }
    };

    this.conn.ontrack = (event) => {
      if (event.streams) {
        this.addVideoElem(event.streams[0]);
      }
    };

    // Add local stream to connection
    localStream.getTracks().forEach((track) => {
      this.conn.addTrack(track, localStream);
    });

    // Setup db references
    this.offerRef = collection(db, `${docRef.path}/ReceivedOffers`);
    this.answerRef = collection(db, `${docRef.path}/ReceivedAnswers`);
    this.iceRef = collection(db, `${docRef.path}/ReceivedICE`);

    // Check if peer is alive
    this.check_heartbeat = setInterval(async () => {
      let doc = await getDoc(docRef);
      if (doc.exists()) {
        if (Date.now() - doc.data().heartbeat > 5000) {
          this.isAlive = false;
        }
      }
    });
  }

  async makeOffer() {
    let offer = await this.conn.createOffer();
    await this.conn.setLocalDescription(offer);

    addDoc(this.offerRef, { src_peer: UUID, offer: JSON.stringify(offer) });
  }

  async accpetOffer(offer: any) {
    await this.conn.setRemoteDescription(offer);
    let answer = await this.conn.createAnswer();
    await this.conn.setLocalDescription(answer);

    addDoc(this.answerRef, { src_peer: UUID, answer: JSON.stringify(answer) });
  }

  async acceptAnswer(answer: any) {
    await this.conn.setRemoteDescription(answer);
  }

  addIce(candidate: any) {
    if (candidate) {
      this.conn.addIceCandidate(candidate);
    }
  }

  sendIce(candidate: any) {
    addDoc(this.iceRef, { src_peer: UUID, ice: JSON.stringify(candidate) });
  }

  addVideoElem(stream: MediaStream) {
    let elem = $(`<video id="${this.id}" autoplay playsinline></video>`);
    $(videoContainer).append(elem);
    (document.getElementById(`${this.id}`) as HTMLVideoElement).srcObject =
      stream;
  }

  close() {
    console.log("Closing connection for peer ", +this.id);
    this.conn.close();
    clearInterval(this.check_heartbeat);
    $(`#${this.id}`).remove();
  }
}

function getClientById(id: number) {
  for (let client of CLIENTS) {
    if (client.id == id) {
      return client;
    }
  }
  return null;
}

function setupSnapshots(
  selfIceRef: CollectionReference,
  selfOfferRef: CollectionReference,
  selfAnswerRef: CollectionReference,
  roomRef: DocumentReference
) {
  onSnapshot(selfOfferRef, (snapshot) => {
    for (const change of snapshot.docChanges()) {
      if (change.type == "added") {
        let data = change.doc.data();
        console.log(`Got offer from ${data.src_peer}`);
        let clientRef = doc(db, `${roomRef.path}/clients`, data.src_peer);
        let client = new PeerClient(data.src_peer, clientRef);
        CLIENTS.push(client);
        client.accpetOffer(JSON.parse(data.offer));
        deleteDoc(change.doc.ref);
      }
    }
  });
  onSnapshot(selfAnswerRef, (snapshot) => {
    for (const change of snapshot.docChanges()) {
      if (change.type == "added") {
        let data = change.doc.data();
        console.log(`Got answer from ${data.src_peer}`);
        let client = getClientById(data.src_peer);
        if (client) {
          client.acceptAnswer(JSON.parse(data.answer));
        }
        deleteDoc(change.doc.ref);
      }
    }
  });
  onSnapshot(selfIceRef, (snapshot) => {
    for (const change of snapshot.docChanges()) {
      if (change.type == "added") {
        let data = change.doc.data();
        console.log(`Got ICE from ${data.src_peer}`);
        let client = getClientById(data.src_peer);
        if (client) {
          client.addIce(JSON.parse(data.ice));
        }
        deleteDoc(change.doc.ref);
      }
    }
  });
}

$("#disconnect-btn").click(() => (window.location.href = "/"));

start();
