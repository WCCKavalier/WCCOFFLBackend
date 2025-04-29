const axios = require('axios');

async function fetchModels() {
  try {
    console.log("🔍 Fetching models...");

    // Fetch available models from the Gemini API
    const response = await axios.get(`https://generativelanguage.googleapis.com/v1/models?key=${process.env.GEMINI_API_KEY}`);
    
    // Filter models: Keep only active/available models (excluding deprecated and non-free ones)
    const availableModels = response.data.models
      .map(model => model.name.split('/').pop())
      .filter(name => {
        // Exclude deprecated models by not including certain known patterns
        const isDeprecated = name.includes('deprecated') || name.includes('lite') || name.includes('embed');
        return !isDeprecated;
      })
      .reverse(); // Reverse the list to prioritize latest models first
    
    if (availableModels.length === 0) {
      throw new Error("No models found.");
    }

    // console.log("✅ Models fetched:", availableModels);
    return availableModels;
  } catch (err) {
    console.error("❌ Error fetching models from Gemini API:", err.message);
    throw new Error("Failed to fetch models from Gemini API.");
  }
}

async function getCurrentModel() {
  const availableModels = await fetchModels();
  
  // Always use the best model (e.g., gemini-2.0-flash) first, if available
  const primaryModel = 'gemini-2.0-flash';
  if (availableModels.includes(primaryModel)) {
    return primaryModel;
  }

  // Otherwise, return the first available model
  return availableModels[0];
}

function moveToNextModel(currentIndex, availableModels) {
  // Simple logic to rotate to the next model (looping around)
  return (currentIndex + 1) % availableModels.length;
}

module.exports = {
  fetchModels,
  getCurrentModel,
  moveToNextModel,
};
