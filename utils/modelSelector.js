const axios = require('axios');

async function fetchModels() {
  try {
    console.log("🔍 Fetching models...");

    const response = await axios.get(`https://generativelanguage.googleapis.com/v1/models?key=${process.env.GEMINI_API_KEY}`);
    
    const availableModels = response.data.models
      .map(model => model.name.split('/').pop())
      .filter(name => {
        const isDeprecated = name.includes('deprecated') || name.includes('embed') || name.includes('tuning');
        const isInternalVariant = /\d{3}/.test(name); // filters '001', '002', etc.
        return !isDeprecated && !isInternalVariant;
      })
      .reverse();

    if (availableModels.length === 0) {
      throw new Error("No models found.");
    }
    console.log(availableModels);
    return availableModels;
  } catch (err) {
    console.error("❌ Error fetching models from Gemini API:", err.message);
    throw new Error("Failed to fetch models from Gemini API.");
  }
}

async function getModelListWithDefaultFirst() {
  const availableModels = await fetchModels();

  const defaultModel = 'gemini-2.0-flash';
  const filteredModels = availableModels.filter(model => model !== defaultModel);

  // Put default model at front
  const orderedModels = [defaultModel, ...filteredModels.filter(Boolean)];

  return orderedModels;
}

function moveToNextModel(currentIndex, availableModels) {
  if (!Array.isArray(availableModels) || availableModels.length === 0) {
    throw new Error("No available models to switch to.");
  }
  return (currentIndex + 1) % availableModels.length;
}

module.exports = {
  fetchModels,
  getModelListWithDefaultFirst,
  moveToNextModel,
};
