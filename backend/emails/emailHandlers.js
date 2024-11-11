import {
  createCommentNotificationEmailTemplate,
  createWelcomeEmailTemplate,
} from "./emailTemplates.js";
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

export const sendCommentNotificationEmail = async (
  recipientEmail,
  recipientName,
  commenterName,
  postUrl,
  commentContent,
) => {
  const recipient = [{ email }];

  try {
    const response = await mailtrapClient.send({
      from: sender,
      to: recipient,
      subject: "New comment on your post",
      html: createCommentNotificationEmailTemplate(
        recipientName,
        commenterName,
        postUrl,
        commentContent,
      ),
      category: "comment_notification",
    });

    console.log("Comment notification email sent successfully", response);
  } catch (error) {
    throw error;
  }
};
