const completion = await openai.chat.completions.create({
        model: "openrouter/free",
        messages: [{ role: "user", content: messageContent }],
      });

      // Added the '?' to safely handle undefined choices if the API errors out
      rawText = completion?.choices?.[0]?.message?.content || "{}";
    }

    // Clean and Parse JSON robustly
    let cleanJson = rawText.replace(/```json|```/g, "").trim();
    
    // Find the first { and last } to strip out any AI conversational junk (like "User Safety: safe")
    const startIndex = cleanJson.indexOf('{');
    const endIndex = cleanJson.lastIndexOf('}');
    
    if (startIndex !== -1 && endIndex !== -1) {
      cleanJson = cleanJson.substring(startIndex, endIndex + 1);
    }

    // Fallback to an empty object if the AI returned pure garbage
    if (!cleanJson || cleanJson === "") {
      cleanJson = "{}";
    }

    const parsedData = JSON.parse(cleanJson);
