export const handler = async () => {
  const apiKey = process.env.METERED_API_KEY;

  if (!apiKey) {
    throw new Error("METERED_API_KEY is not set");
  }

  try {
    const response = await fetch(
      `https://pipe-os.metered.live/api/v1/turn/credentials?apiKey=${apiKey}`
    );
    
    if (!response.ok) {
      throw new Error(`Metered API error: ${response.status}`);
    }

    const data = await response.json();
    return data;
  } catch (error) {
    console.error("Error fetching TURN credentials:", error);
    throw error;
  }
};
