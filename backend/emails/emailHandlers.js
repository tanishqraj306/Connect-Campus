import { createWelcomeEmailTemplate } from "./emailTemplates.js";
import { mailtrapClient, sender } from "./mailtrap.js";

export const sendWelcomeEmail = async (email, name, profileUrl) => {
  const recipient = [{ email }];

  try {
    const response = await mailtrapClient.send({
      from: sender,
      to: recipient,
      subject: "Welcome to Connect Campus",
      html: createWelcomeEmailTemplate(name, profileUrl),
      category: "welcome",
    });

    console.log("Welcome email sent successfully", response);
  } catch (error) {
    throw error;
  }
};
