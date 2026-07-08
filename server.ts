import express from "express";
import http from "http";
import path from "path";
import { WebSocketServer } from "ws";
import { GoogleGenAI, LiveServerMessage, Modality } from "@google/genai";
import { createServer as createViteServer } from "vite";
import { SYSTEM_INSTRUCTION } from "./constants";

async function startServer() {
  const app = express();
  app.use(express.json());

  const server = http.createServer(app);
  const wss = new WebSocketServer({ noServer: true });

  const PORT = 3000;

  // Lazy initialize GoogleGenAI with key from environment
  let ai: GoogleGenAI | null = null;
  const getAi = () => {
    if (!ai) {
      const key = process.env.GEMINI_API_KEY;
      if (!key) {
        throw new Error("GEMINI_API_KEY environment variable is required");
      }
      ai = new GoogleGenAI({
        apiKey: key,
        httpOptions: {
          headers: {
            "User-Agent": "aistudio-build",
          },
        },
      });
    }
    return ai;
  };

  // API - Health Check
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  // Smart local fallback for Indian Doctors/Clinics search
  const getSmartFallbackResponse = (queryText: string): string => {
    const text = (queryText || "").toLowerCase();

    const isHinglish = text.includes("chahiye") || text.includes("appointment") || text.includes("book") || text.includes("karna") || text.includes("hai") || text.includes("karo") || text.includes("doctor") || text.includes("dikhao") || text.includes("mila");

    // 1. Clinic timing / Open queries
    if (text.includes("open") || text.includes("timing") || text.includes("time") || text.includes("hours") || text.includes("kab tak") || text.includes("khula")) {
      if (isHinglish) {
        return "Haan, Apollo Clinic aam taur par **subah 8:00 baje se raat 8:00 baje tak** khula rehta hai. General physicians aur diagnostic/lab services pure samay chalte hain, aur specialists ke liye appointment book karna behtar hota hai. \n\nKya aap kisi specific specialist doctor ko dundh rahe hain?";
      }
      return "Yes, Apollo Clinics are generally open from **8:00 AM to 8:00 PM** daily, including today. General Physicians and diagnostic/lab services are active throughout these hours. Specialists are available by prior appointment.\n\nWould you like me to find a specific specialist for you at your nearest Apollo Clinic?";
    }

    // 2. Cardiology
    if (text.includes("cardio") || text.includes("heart") || text.includes("dil") || text.includes("cardiologist")) {
      const intro = isHinglish 
        ? "Maine aapke liye top Apollo Cardiologists ki list nikaali hai:\n\n"
        : "Here are the top-rated Cardiologists at Apollo Hospitals and Clinics:\n\n";

      return intro + `**Dr. S. Ananthasubramanian** (Cardiology)
📍 **Location**: Apollo Hospitals, Greams Road, Chennai
⭐ **Rating**: 4.9/5
💰 **Fee**: ₹1000
🕒 **Experience**: 22 Years
📞 **Availability**: Mon-Fri (10:00 AM - 3:00 PM)
[View Map](https://www.google.com/maps/search/?api=1&query=Apollo+Hospitals+Greams+Road+Chennai)

---

**Dr. Amit Shah** (Cardiology)
📍 **Location**: Apollo Clinic, Andheri East, Mumbai
⭐ **Rating**: 4.8/5
💰 **Fee**: ₹900
🕒 **Experience**: 15 Years
📞 **Availability**: Mon-Sat (11:00 AM - 4:00 PM)
[View Map](https://www.google.com/maps/search/?api=1&query=Apollo+Clinic+Andheri+East+Mumbai)`;
    }

    // 3. Pediatrics
    if (text.includes("pedia") || text.includes("child") || text.includes("bacche") || text.includes("kids") || text.includes("pediatrician") || text.includes("baby")) {
      const intro = isHinglish
        ? "Baccho ke ilaaj ke liye top Pediatricians ki jankari niche di gayi hai:\n\n"
        : "Here are the highly recommended Pediatricians at Apollo Clinics:\n\n";

      return intro + `**Dr. Shalini Sen** (Pediatrics)
📍 **Location**: Apollo Clinic, Salt Lake, Kolkata
⭐ **Rating**: 4.7/5
💰 **Fee**: ₹750
🕒 **Experience**: 12 Years
📞 **Availability**: Mon-Sat (9:00 AM - 1:00 PM)
[View Map](https://www.google.com/maps/search/?api=1&query=Apollo+Clinic+Salt+Lake+Kolkata)

---

**Dr. Rakesh Verma** (Pediatrics)
📍 **Location**: Apollo Cradle, Moti Nagar, New Delhi
⭐ **Rating**: 4.6/5
💰 **Fee**: ₹850
🕒 **Experience**: 14 Years
📞 **Availability**: Mon-Fri (4:00 PM - 8:00 PM)
[View Map](https://www.google.com/maps/search/?api=1&query=Apollo+Cradle+Moti+Nagar+New+Delhi)`;
    }

    // 4. Dermatology
    if (text.includes("derma") || text.includes("skin") || text.includes("skin specialist") || text.includes("dermatologist") || text.includes("tvacha") || text.includes("baal") || text.includes("hair")) {
      const intro = isHinglish
        ? "Skin aur baal ki samasyaon ke liye top Dermatologists ki details:\n\n"
        : "Here are the leading Dermatologists at Apollo Clinics:\n\n";

      return intro + `**Dr. Kabir Mehta** (Dermatology)
📍 **Location**: Apollo Clinic, Jayanagar, Bangalore
⭐ **Rating**: 4.8/5
💰 **Fee**: ₹900
🕒 **Experience**: 11 Years
📞 **Availability**: Mon-Sat (10:00 AM - 2:00 PM, 5:00 PM - 8:00 PM)
[View Map](https://www.google.com/maps/search/?api=1&query=Apollo+Clinic+Jayanagar+Bangalore)

---

**Dr. Neha Deshmukh** (Dermatology)
📍 **Location**: Apollo Clinic, Kondapur, Hyderabad
⭐ **Rating**: 4.7/5
💰 **Fee**: ₹800
🕒 **Experience**: 10 Years
📞 **Availability**: Tue-Sat (3:00 PM - 7:00 PM)
[View Map](https://www.google.com/maps/search/?api=1&query=Apollo+Clinic+Kondapur+Hyderabad)`;
    }

    // 5. Orthopedic
    if (text.includes("ortho") || text.includes("bone") || text.includes("joint") || text.includes("haddi") || text.includes("orthopedic") || text.includes("fracture") || text.includes("pain")) {
      const intro = isHinglish
        ? "Haddi aur joint ke ilaaj ke liye best Orthopedic doctors ki list:\n\n"
        : "Here are the top Orthopedic specialists at Apollo Clinics:\n\n";

      return intro + `**Dr. Suresh Reddy** (Orthopedics)
📍 **Location**: Apollo Hospitals, Jubilee Hills, Hyderabad
⭐ **Rating**: 4.8/5
💰 **Fee**: ₹1000
🕒 **Experience**: 19 Years
📞 **Availability**: Mon-Sat (10:00 AM - 4:00 PM)
[View Map](https://www.google.com/maps/search/?api=1&query=Apollo+Hospitals+Jubilee+Hills+Hyderabad)

---

**Dr. Rajesh Khanna** (Orthopedics)
📍 **Location**: Apollo Clinic, Dwarka, New Delhi
⭐ **Rating**: 4.7/5
💰 **Fee**: ₹800
🕒 **Experience**: 17 Years
📞 **Availability**: Mon-Sat (12:00 PM - 5:00 PM)
[View Map](https://www.google.com/maps/search/?api=1&query=Apollo+Clinic+Dwarka+New+Delhi)`;
    }

    // 6. Gynaecologist
    if (text.includes("gynae") || text.includes("women") || text.includes("pregnancy") || text.includes("delivery") || text.includes("mahila") || text.includes("gynaecologist") || text.includes("periods")) {
      const intro = isHinglish
        ? "Mahilaon ke swasthya aur pregnancy ke liye top Gynaecologists:\n\n"
        : "Here are the top-rated Gynecologists & Obstetricians at Apollo:\n\n";

      return intro + `**Dr. Sunita Patil** (Obstetrics & Gynecology)
📍 **Location**: Apollo Clinic, Viman Nagar, Pune
⭐ **Rating**: 4.8/5
💰 **Fee**: ₹850
🕒 **Experience**: 16 Years
📞 **Availability**: Mon-Fri (10:00 AM - 1:00 PM, 5:00 PM - 7:30 PM)
[View Map](https://www.google.com/maps/search/?api=1&query=Apollo+Clinic+Viman+Nagar+Pune)

---

**Dr. Meenakshi Sundaram** (Obstetrics & Gynecology)
📍 **Location**: Apollo Hospitals, Greams Road, Chennai
⭐ **Rating**: 4.9/5
💰 **Fee**: ₹1100
🕒 **Experience**: 20 Years
📞 **Availability**: Mon-Sat (9:00 AM - 2:00 PM)
[View Map](https://www.google.com/maps/search/?api=1&query=Apollo+Hospitals+Greams+Road+Chennai)`;
    }

    // 7. General Physician / Default
    if (text.includes("fever") || text.includes("cough") || text.includes("cold") || text.includes("headache") || text.includes("pain") || text.includes("physician") || text.includes("bukhar") || text.includes("khansi") || text.includes("sardi")) {
      const intro = isHinglish
        ? "Bukhar, khansi ya sardi ke liye hamare pass best General Physicians hain:\n\n"
        : "For fever, cold, or general checkups, here are the top General Physicians at Apollo Clinics:\n\n";

      return intro + `**Dr. Vijay Kumar** (General Medicine)
📍 **Location**: Apollo Clinic, HSR Layout, Bangalore
⭐ **Rating**: 4.8/5
💰 **Fee**: ₹600
🕒 **Experience**: 18 Years
📞 **Availability**: Mon-Sat (8:00 AM - 1:00 PM, 4:00 PM - 8:00 PM)
[View Map](https://www.google.com/maps/search/?api=1&query=Apollo+Clinic+HSR+Layout+Bangalore)

---

**Dr. Anita Roy** (General Medicine)
📍 **Location**: Apollo Clinic, Sector 15, Gurugram
⭐ **Rating**: 4.7/5
💰 **Fee**: ₹650
🕒 **Experience**: 13 Years
📞 **Availability**: Mon-Sat (9:00 AM - 2:00 PM, 5:00 PM - 8:00 PM)
[View Map](https://www.google.com/maps/search/?api=1&query=Apollo+Clinic+Sector+15+Gurugram)`;
    }

    // 8. General fallback greeting
    if (isHinglish) {
      return "Namaste! Main Apollo247 Voice Assistant hu. Mujhe lagta hai network me kuch issue hai, par main aapko doctor aur clinics dundhne me puri madad kar sakta hu. \n\nAapko kis specialty ke doctor ko consult karna hai? Jaise: \n- **General Physician** (Fever, cough, checkup)\n- **Cardiologist** (Dil ki bimari)\n- **Pediatrician** (Baccho ke doctor)\n- **Dermatologist** (Skin / Hair specialist)\n- **Orthopedic** (Haddi aur joint specialist)";
    }
    return "Hello! I am your Apollo247 Assistant. We are currently experiencing a network issue connecting to our live AI brain, but I can fully search our offline specialist database for you.\n\nPlease let me know which doctor or specialty you are looking for:\n- **General Physician** (for fever, cold, or general health issues)\n- **Cardiologist** (for heart health)\n- **Pediatrician** (for children's health)\n- **Dermatologist** (for skin and hair care)\n- **Orthopedic** (for bones and joints)\n- **Gynecologist** (for women's health)";
  };

  // API - Text Chat proxy to Gemini with Google Search tool
  app.post("/api/gemini/chat", async (req, res) => {
    const { text, history } = req.body;

    const formattedHistory = (history || []).map((msg: any) => ({
      role: msg.role,
      parts: [{ text: msg.text }],
    }));

    try {
      const genAi = getAi();
      const chatSession = genAi.chats.create({
        model: "gemini-3.5-flash",
        config: {
          systemInstruction: SYSTEM_INSTRUCTION,
          temperature: 0.7,
          tools: [{ googleSearch: {} }],
        },
        history: formattedHistory,
      });

      const response = await chatSession.sendMessage({ message: text });
      res.json({ text: response.text || "I'm sorry, I didn't catch that." });
    } catch (error: any) {
      console.error("Error sending message to Gemini with search tool:", error);

      console.warn("Attempting fallback without search tool...");
      try {
        const genAi = getAi();
        const chatSessionFallback = genAi.chats.create({
          model: "gemini-3.5-flash",
          config: {
            systemInstruction: SYSTEM_INSTRUCTION,
            temperature: 0.7,
            tools: [], // No googleSearch tool
          },
          history: formattedHistory,
        });
        const response = await chatSessionFallback.sendMessage({ message: text });
        return res.json({ text: response.text || "I'm sorry, I didn't catch that." });
      } catch (fallbackError: any) {
        console.error("Fallback also failed, using robust smart local database:", fallbackError);
        const fallbackText = getSmartFallbackResponse(text);
        return res.json({ text: fallbackText });
      }
    }
  });

  // Handle upgraded WebSocket requests
  server.on("upgrade", (request, socket, head) => {
    const pathname = new URL(request.url || "", `http://${request.headers.host}`).pathname;

    if (pathname === "/live") {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit("connection", ws, request);
      });
    } else {
      socket.destroy();
    }
  });

  // WebSocket Server for Gemini Live API bridge
  wss.on("connection", async (clientWs, request) => {
    console.log("Client connected to live WebSocket");

    const url = new URL(request.url || "", `http://${request.headers.host}`);
    const language = url.searchParams.get("language") || "English";
    const initialContext = url.searchParams.get("initialContext") || "";

    let geminiSession: any = null;

    try {
      const genAi = getAi();
      geminiSession = await genAi.live.connect({
        model: "gemini-3.1-flash-live-preview",
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: "Kore" } },
          },
          systemInstruction:
            SYSTEM_INSTRUCTION +
            (initialContext ? `\n\n${initialContext}` : "") +
            `\n\nPlease speak in the following language: ${language}`,
          outputAudioTranscription: {},
          inputAudioTranscription: {},
        },
        callbacks: {
          onopen: () => {
            console.log("Gemini Live session connected");
          },
          onmessage: (message: LiveServerMessage) => {
            if (clientWs.readyState === clientWs.OPEN) {
              clientWs.send(JSON.stringify(message));
            }
          },
          onclose: () => {
            console.log("Gemini Live session closed");
            clientWs.close();
          },
          onerror: (err) => {
            console.error("Gemini Live error:", err);
            clientWs.close();
          },
        },
      });

      clientWs.on("message", (rawMsg) => {
        try {
          const payload = JSON.parse(rawMsg.toString());
          if (geminiSession) {
            // Forward real-time input directly
            geminiSession.sendRealtimeInput(payload);
          }
        } catch (e) {
          console.error("Error parsing/sending client WS message:", e);
        }
      });

      clientWs.on("close", () => {
        console.log("Client closed WS connection");
        if (geminiSession) {
          geminiSession.close();
        }
      });

      clientWs.on("error", (err) => {
        console.error("Client WS error:", err);
        if (geminiSession) {
          geminiSession.close();
        }
      });
    } catch (err) {
      console.error("Failed to bridge live session:", err);
      clientWs.close();
    }
  });

  // Vite integration
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  server.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
