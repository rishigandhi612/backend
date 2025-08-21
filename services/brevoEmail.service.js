// services/brevoEmail.service.js
const SibApiV3Sdk = require("sib-api-v3-sdk");
require("dotenv").config();

const defaultClient = SibApiV3Sdk.ApiClient.instance;
const apiKey = defaultClient.authentications["api-key"];
apiKey.apiKey = process.env.BREVO_API_KEY;

const apiInstance = new SibApiV3Sdk.TransactionalEmailsApi();

const sendEmailWithAttachment = async (
  to,
  subject,
  htmlContent,
  attachments
) => {
  const sendSmtpEmail = new SibApiV3Sdk.SendSmtpEmail();

  sendSmtpEmail.subject = subject;
  sendSmtpEmail.to = [{ email: to }];
  sendSmtpEmail.sender = {
    name: "Hemant Traders Sales",
    email: "rishigandhi021@gmail.com",
  };
  sendSmtpEmail.htmlContent = htmlContent;

  if (attachments && attachments.length > 0) {
    sendSmtpEmail.attachment = attachments;
  }

  return await apiInstance.sendTransacEmail(sendSmtpEmail);
};

module.exports = {
  sendEmailWithAttachment,
};
