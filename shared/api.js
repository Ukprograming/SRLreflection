const API_URL = 'https://script.google.com/macros/s/AKfycbxkigQHCukgui_U1MgrQ8_szrRd7mD4kDRrkC8h0osNtPH58liJiVbxo_GpNhZOnAws/exec'; // Placeholder

/**
 * Sends a POST request to the GAS Web App.
 * @param {string} action - The action name (e.g., 'login', 'submitReflection')
 * @param {object} payload - The data to send
 * @param {object} auth - Authentication object { id, token }
 * @returns {Promise<object>} - The JSON response
 */
async function apiRequest(action, payload = {}, auth = null) {
  const body = {
    action,
    payload,
    auth: auth || getAuthFromStorage()
  };

  try {
    // We use text/plain to avoid CORS preflight options request which GAS doesn't handle well for simple web apps
    // The backend must parse the text body as JSON.
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain;charset=utf-8',
      },
      body: JSON.stringify(body)
    });

    const result = await response.json();
    if (result.error) {
      throw new Error(result.error);
    }
    return result;

  } catch (error) {
    console.error(`API Error (${action}):`, error);
    throw error;
  }
}

function getAuthFromStorage() {
  const stored = localStorage.getItem('srl_auth');
  return stored ? JSON.parse(stored) : null;
}
