import { GoogleGenAI } from '@google/genai';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405.json({ error: 'Method not allowed' }));
  }

  try {
    const { message, history, image } = req.body;
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

    let contents = history ? [...history] : [];
    
    let currentPart = [{ text: message || "Analyze this" }];
    if (image) {
      const base64Data = image.split(',')[1] || image;
      currentPart.push({
        inlineData: {
          mimeType: "image/jpeg",
          data: base64Data
        }
      });
    }
    contents.push({ role: 'user', parts: currentPart });

    const response = await ai.models.generateContent({
      model: 'gemini-3.6-flash',
      contents: contents,
      config: {
        tools: [{ googleSearch: {} }],
        systemInstruction: "Aap ek expert AI assistant aur hardware repair guru hain. Jab user camera se image bheje, toh use analyze karke hardware faults, shorting ya IC damage ko pehchan kar step-by-step solution batayein."
      }
    });

    const reply = response.text;
    return res.status(200).json({ reply });

  } catch (error) {
    console.error("API Error:", error);
    return res.status(500).json({ error: error.message || "Internal Server Error" });
  }
}
,
