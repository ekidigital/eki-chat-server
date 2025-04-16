import User from "../models/User.js";

async function sendPushNotifications(userId, title, body, data, sticky) {
  const user = await User.findOne({ code: userId });

  if (!user || !user.devices.length) {
    console.log("No devices found for user:", userId);
    return;
  }

  // Validate push tokens
  const validDevices = user.devices.filter(device =>
    device.expoPushToken.startsWith("ExponentPushToken")
  );

  if (!validDevices.length) {
    console.log("No valid Expo push tokens found.");
    return;
  }

  const messages = validDevices.map((device) => ({
    to: device.expoPushToken,
    sound: "default",
    title,
    body,
    data,
    sticky: sticky || false
  }));

  // Send notifications in batches of 100
  const chunkSize = 100;
  const chunkedMessages = [];
  for (let i = 0; i < messages.length; i += chunkSize) {
    chunkedMessages.push(messages.slice(i, i + chunkSize));
  }

  // Function to send requests with retry logic
  async function sendWithRetry(chunk, maxRetries = 5) {
    let attempts = 0;

    while (attempts < maxRetries) {
      try {
        const response = await fetch("https://exp.host/--/api/v2/push/send", {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
          },
          body: JSON.stringify(chunk),
        });

        if (!response.ok) throw new Error(`HTTP Error: ${response.status}`);

        const result = await response.json();
        console.log("Push notifications sent:", result);

        // Handle invalid push tokens
        if (result.data) {
          result.data.forEach(async (ticket, index) => {
            if (ticket.status === "error" && ticket.details?.error === "DeviceNotRegistered") {
              console.log("Removing invalid token:", chunk[index].to);
              await User.updateOne(
                { _id: user._id },
                { $pull: { devices: { expoPushToken: chunk[index].to } } }
              );
            }
          });
        }

        return result; // Exit on success
      } catch (error) {
        attempts++;
        console.error(`Attempt ${attempts} failed:`, error);

        if (attempts >= maxRetries) {
          console.error("Max retry attempts reached. Push notifications failed.");
          return null;
        }

        // Exponential backoff delay (2s, 4s, 8s, etc.)
        const delay = Math.pow(2, attempts) * 1000;
        console.log(`Retrying in ${delay / 1000} seconds...`);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  // Send all chunks with retry logic
  for (const chunk of chunkedMessages) {
    await sendWithRetry(chunk);
  }
}

export default sendPushNotifications;
