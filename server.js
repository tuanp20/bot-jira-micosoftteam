const express = require("express");
const bodyParser = require("body-parser");
const axios = require("axios");
require("dotenv").config();

// --- Chỉ import từ 'botbuilder' ---
// Các lớp cần thiết đều nằm trong botbuilder từ v4.6 trở đi
const {
  BotFrameworkAdapter,
  TurnContext,
  MessageFactory,
  TeamsActivityHandler, // TeamsActivityHandler đã được tích hợp vào botbuilder
  CardFactory,
} = require("botbuilder");

const app = express();
const PORT = process.env.PORT || 3000;

// --- Cấu hình Bot Framework và Azure Bot ---
const MICROSOFT_APP_ID = process.env.MICROSOFT_APP_ID;
const MICROSOFT_APP_PASSWORD = process.env.MICROSOFT_APP_PASSWORD;

// --- Cấu hình Jira API để thêm bình luận ---
const JIRA_API_BASE_URL = process.env.JIRA_API_BASE_URL;
const JIRA_USERNAME = process.env.JIRA_USERNAME;
const JIRA_API_TOKEN = process.env.JIRA_API_TOKEN;

// --- Cấu hình định tuyến kênh Teams theo dự án Jira (nếu có) ---
// Ánh xạ Project Key của Jira với Teams Webhook URL tương ứng
const projectChannelMap = {
  // Ví dụ:
  // "PROJA": process.env.TEAMS_WEBHOOK_URL_PROJECT_A,
  // "PROJB": process.env.TEAMS_WEBHOOK_URL_PROJECT_B,
};
const DEFAULT_TEAMS_WEBHOOK_URL = process.env.TEAMS_WEBHOOK_URL_DEFAULT;

// Kiểm tra các biến môi trường cần thiết
if (
  !MICROSOFT_APP_ID ||
  !MICROSOFT_APP_PASSWORD ||
  !JIRA_API_BASE_URL ||
  !JIRA_USERNAME ||
  !JIRA_API_TOKEN ||
  !DEFAULT_TEAMS_WEBHOOK_URL
) {
  console.error(
    "Lỗi: Thiếu các biến môi trường cần thiết. Vui lòng kiểm tra file .env của bạn."
  );
  process.exit(1);
}

// Tạo Adapter cho Bot Framework
const adapter = new BotFrameworkAdapter({
  appId: MICROSOFT_APP_ID,
  appPassword: MICROSOFT_APP_PASSWORD,
});

// Xử lý lỗi trong quá trình xử lý hoạt động của bot
adapter.onTurnError = async (context, error) => {
  console.error(`\n [onTurnError] Lỗi không được xử lý: ${error}`);
  await context.sendActivity(
    "Xin lỗi, có vẻ như đã xảy ra lỗi trong quá trình xử lý yêu cầu của bạn."
  );
};

// --- Định nghĩa logic của Bot ---
// (Lớp này vẫn giữ nguyên tên và cách extends)
class JiraTeamsBot extends TeamsActivityHandler {
  // TeamsActivityHandler bây giờ từ 'botbuilder'
  constructor() {
    super();

    this.onMessage(async (context, next) => {
      const text = context.activity.text;
      if (text && text.toLowerCase().includes("hello")) {
        await context.sendActivity(
          `Chào bạn! Tôi là bot thông báo Jira. Tôi có thể giúp bạn theo dõi các thay đổi trên Jira và bình luận ngược lại.`
        );
      } else {
        await context.sendActivity(
          `Tôi không hiểu lệnh của bạn. Vui lòng tương tác qua các thẻ thông báo Jira.`
        );
      }
      await next();
    });

    // this.onAdaptiveCardInvoke(async (context, invokeValue) => {
    //     const actionData = invokeValue.action.data;
    //     const commentText = actionData.commentInput;
    //     const issueKey = actionData.issueKey;

    //     if (commentText && issueKey) {
    //         try {
    //             const jiraAuth = Buffer.from(`${JIRA_USERNAME}:${JIRA_API_TOKEN}`).toString('base64');
    //             await axios.post(`${JIRA_API_BASE_URL}/issue/${issueKey}/comment`,
    //                 { "body": commentText },
    //                 {
    //                     headers: {
    //                         'Authorization': `Basic ${jiraAuth}`,
    //                         'Content-Type': 'application/json'
    //                     }
    //                 }
    //             );
    //             await context.sendActivity(MessageFactory.text(`Bình luận của bạn đã được thêm vào issue **${issueKey}** trên Jira thành công.`));
    //         } catch (error) {
    //             console.error(`Lỗi khi thêm bình luận vào Jira cho issue ${issueKey}:`, error.message);
    //             if (error.response) {
    //                 console.error('Jira API Response Status:', error.response.status);
    //                 console.error('Jira API Response Data:', error.response.data);
    //             }
    //             await context.sendActivity(MessageFactory.text(`Xin lỗi, không thể thêm bình luận vào issue **${issueKey}**. Vui lòng kiểm tra lại quyền hoặc cấu hình Jira API.`));
    //         }
    //     } else {
    //         await context.sendActivity(MessageFactory.text('Không nhận được nội dung bình luận hoặc ID issue hợp lệ từ thẻ.'));
    //     }
    //     return {};
    // });
    this.onAdaptiveCardInvoke(async (context, invokeValue) => {
      const actionData = invokeValue.action.data;
      const commentText = actionData.commentInput;
      const issueKey = actionData.issueKey;

      if (commentText && issueKey) {
        try {
          const jiraAuth = Buffer.from(
            `${JIRA_USERNAME}:${JIRA_API_TOKEN}`
          ).toString("base64");
          await axios.post(
            `${JIRA_API_BASE_URL}/issue/${issueKey}/comment`,
            { body: commentText },
            {
              headers: {
                Authorization: `Basic ${jiraAuth}`,
                "Content-Type": "application/json",
              },
            }
          );
          await context.sendActivity(
            MessageFactory.text(
              `Bình luận của bạn đã được thêm vào issue **${issueKey}** trên Jira thành công.`
            )
          );
        } catch (error) {
          console.error(
            `Lỗi khi thêm bình luận vào Jira cho issue ${issueKey}:`,
            error.message
          );
          if (error.response) {
            console.error("Jira API Response Status:", error.response.status);
            console.error("Jira API Response Data:", error.response.data);
          }
          await context.sendActivity(
            MessageFactory.text(
              `Xin lỗi, không thể thêm bình luận vào issue **${issueKey}**. Vui lòng kiểm tra lại quyền hoặc cấu hình Jira API.`
            )
          );
        }
      } else {
        await context.sendActivity(
          MessageFactory.text(
            "Không nhận được nội dung bình luận hoặc ID issue hợp lệ từ thẻ."
          )
        );
      }

      // --- Dòng này là rất quan trọng để khắc phục lỗi ---
      return {}; // Đảm bảo luôn trả về một đối tượng rỗng
    });
  }
}

const bot = new JiraTeamsBot(); // Khởi tạo Bot của bạn

// Middleware để phân tích cú pháp body của request dưới dạng JSON
app.use(bodyParser.json());

// --- Endpoint để nhận Webhook từ Jira ---
// Phần này không thay đổi
app.post("/jira-webhook", async (req, res) => {
  const jiraPayload = req.body;

  try {
    const issue = jiraPayload.issue;
    const projectKey = issue?.fields?.project?.key;

    let targetTeamsWebhookUrl = DEFAULT_TEAMS_WEBHOOK_URL;
    if (projectKey && projectChannelMap[projectKey]) {
      targetTeamsWebhookUrl = projectChannelMap[projectKey];
      console.log(
        `Định tuyến thông báo cho dự án ${projectKey} đến URL tùy chỉnh.`
      );
    } else {
      console.log(
        `Không tìm thấy ánh xạ cho dự án ${projectKey}. Sử dụng URL mặc định.`
      );
    }

    const eventType = jiraPayload.webhookEvent;
    const user =
      jiraPayload.user ||
      jiraPayload.changelog?.author ||
      jiraPayload.comment?.author;
    const changelog = jiraPayload.changelog;
    const comment = jiraPayload.comment;

    let cardTitle = "Thông báo Jira";
    let cardText = "";
    let issueKey = issue?.key || "N/A";
    let issueSummary = issue?.fields?.summary || "N/A";
    let issueLink = issue?.self
      ? issue.self.replace(/rest\/api\/\d+\/issue/, "browse")
      : null;

    const userName = user?.displayName || user?.name || "Người dùng ẩn danh";
    const projectName = issue?.fields?.project?.name || "N/A";

    switch (eventType) {
      case "jira:issue_created":
        cardTitle = `[${projectName}] Issue Mới: ${issueKey} - ${issueSummary}`;
        cardText = `**${userName}** đã tạo một issue mới.`;
        break;
      case "jira:issue_updated":
        cardTitle = `[${projectName}] Issue Cập Nhật: ${issueKey} - ${issueSummary}`;
        cardText = `**${userName}** đã cập nhật issue này.`;
        if (changelog && changelog.items && changelog.items.length > 0) {
          cardText += "\n\n**Các thay đổi:**\n";
          changelog.items.forEach((item) => {
            const fieldName = item.field;
            const oldValue = item.fromString || "trống";
            const newValue = item.toString || "trống";
            cardText += `- **${fieldName}**: "${oldValue}" -> "${newValue}"\n`;
          });
        }
        break;
      case "comment_created":
        cardTitle = `[${projectName}] Bình luận Mới: ${issueKey} - ${issueSummary}`;
        cardText = `**${userName}** đã thêm bình luận:\n\n*${
          comment?.body || "Không có nội dung bình luận"
        }*`;
        break;
      case "jira:issue_assigned":
        const assigneeName = issue?.fields?.assignee?.displayName || "chưa gán";
        cardTitle = `[${projectName}] Issue Gán Người: ${issueKey} - ${issueSummary}`;
        cardText = `**${userName}** đã gán issue này cho **${assigneeName}**.`;
        break;
      case "jira:issue_deleted":
        cardTitle = `[${projectName}] Issue Đã Xóa: ${issueKey} - ${issueSummary}`;
        cardText = `**${userName}** đã xóa issue này.`;
        break;
      default:
        cardTitle = `[${projectName}] Sự kiện Jira: ${eventType} - ${issueKey}`;
        cardText = `Một sự kiện Jira đã xảy ra bởi **${userName}** trên issue này.`;
        break;
    }

    // --- Xây dựng Adaptive Card Payload có trường nhập liệu và nút Submit ---
    const adaptiveCardWithReply = {
      $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
      type: "AdaptiveCard",
      version: "1.2",
      body: [
        {
          type: "TextBlock",
          text: cardTitle,
          size: "Large",
          weight: "Bolder",
          wrap: true,
          color: "Accent",
        },
        {
          type: "TextBlock",
          text: cardText,
          wrap: true,
          spacing: "Medium",
        },
        {
          type: "FactSet",
          facts: [
            { title: "Dự án:", value: projectName },
            { title: "Issue ID:", value: issueKey },
            { title: "Người thực hiện:", value: userName },
            { title: "Thời gian:", value: new Date().toLocaleString("vi-VN") },
          ],
        },
        {
          type: "Input.Text",
          id: "commentInput", // ID của trường nhập liệu để lấy giá trị trong onAdaptiveCardInvoke
          placeholder: "Nhập bình luận của bạn vào đây...",
          isMultiline: true,
        },
      ],
      actions: [
        {
          type: "Action.Submit",
          title: "Bình luận lên Jira",
          data: {
            msteams: {
              type: "messageBack",
              displayText: "Đang gửi bình luận...",
              text: "comment",
              value: {
                issueKey: issueKey, // Nhúng Issue Key vào payload
              },
            },
            issueKey: issueKey, // Thêm trực tiếp vào data để dễ dàng truy cập
          },
        },
        {
          type: "Action.OpenUrl",
          title: `Xem Issue ${issueKey} trên Jira`,
          url: issueLink || "https://your.jira.base.url",
        },
      ],
    };

    // --- Gửi Adaptive Card đến Microsoft Teams thông qua Incoming Webhook ---
    await axios.post(targetTeamsWebhookUrl, {
      type: "message",
      attachments: [
        {
          contentType: "application/vnd.microsoft.card.adaptive",
          content: adaptiveCardWithReply,
        },
      ],
    });

    console.log(
      `[${new Date().toISOString()}] Đã gửi thông báo thành công cho sự kiện: ${eventType} - ${issueKey} của dự án ${projectKey} đến Teams.`
    );
    res.status(200).send("Webhook đã được xử lý và thông báo Teams đã gửi.");
  } catch (error) {
    console.error(
      `[${new Date().toISOString()}] Lỗi khi xử lý webhook hoặc gửi đến Teams:`,
      error.message
    );
    if (error.response) {
      console.error(
        "Phản hồi lỗi chi tiết:",
        error.response.status,
        error.response.data
      );
    }
    res
      .status(200)
      .send(
        "Đã xảy ra lỗi khi xử lý webhook, vui lòng kiểm tra logs của ứng dụng trung gian."
      );
  }
});

// --- Endpoint cho Bot Framework ---
// Đây là nơi Microsoft Teams sẽ gửi tất cả các hoạt động của bot (tin nhắn, tương tác card, v.v.)
app.post("/api/messages", (req, res) => {
  // Xử lý các hoạt động đến từ Teams
  adapter.processActivity(req, res, async (context) => {
    // Chuyển quyền xử lý cho đối tượng bot của chúng ta (JiraTeamsBot)
    await bot.run(context);
  });
});

// --- Khởi động Server ---
app.listen(PORT, () => {
  console.log(`Server đang lắng nghe tại cổng ${PORT}`);
  console.log(
    `Endpoint Webhook cho Jira: http://localhost:${PORT}/jira-webhook`
  );
  console.log(
    `Endpoint cho Microsoft Teams Bot: http://localhost:${PORT}/api/messages`
  );
  console.log(
    `Sử dụng ngrok/Localtunnel để public endpoint /api/messages cho Azure Bot.`
  );
});
