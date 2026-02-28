export const handler = async () => {
  const apiKey = process.env.METERED_API_KEY;

  if (!apiKey) {
    console.error("METERED_API_KEY is not set");
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "METERED_API_KEY is not set" }),
    };
  }

  try {
    const response = await fetch(
      `https://pipe-os.metered.live/api/v1/turn/credentials?apiKey=${apiKey}`
    );
    const data = await response.json();

    return {
      statusCode: 200,
      body: JSON.stringify(data),
    };
  } catch (error) {
    console.error("Error fetching TURN credentials:", error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Failed to fetch TURN credentials" }),
    };
  }
};
