const express = require("express");
const bodyParser = require("body-parser");
const axios = require("axios");
require("dotenv").config();

// Import từ botbuilder
const {
  BotFrameworkAdapter,
  TurnContext,
  MessageFactory,
  TeamsActivityHandler,
  CardFactory,
} = require("botbuilder");

const app = express();
const PORT = process.env.PORT || 3000;

// Cấu hình Bot Framework và Azure Bot
const MICROSOFT_APP_ID = process.env.MICROSOFT_APP_ID;
const MICROSOFT_APP_PASSWORD = process.env.MICROSOFT_APP_PASSWORD;

// Cấu hình Jira API
const JIRA_API_BASE_URL = process.env.JIRA_API_BASE_URL;
const JIRA_USERNAME = process.env.JIRA_USERNAME;
const JIRA_API_TOKEN = process.env.JIRA_API_TOKEN;

// Cấu hình định tuyến kênh Teams theo dự án Jira
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
    "❌ Lỗi: Thiếu các biến môi trường cần thiết. Vui lòng kiểm tra file .env"
  );
  console.error("Cần có: MICROSOFT_APP_ID, MICROSOFT_APP_PASSWORD, JIRA_API_BASE_URL, JIRA_USERNAME, JIRA_API_TOKEN, TEAMS_WEBHOOK_URL_DEFAULT");
  process.exit(1);
}

// Tạo Adapter cho Bot Framework
const adapter = new BotFrameworkAdapter({
  appId: MICROSOFT_APP_ID,
  appPassword: MICROSOFT_APP_PASSWORD,
});

// Xử lý lỗi trong quá trình xử lý hoạt động của bot
adapter.onTurnError = async (context, error) => {
  console.error(`\n❌ [onTurnError] Lỗi không được xử lý: ${error}`);
  console.error('Error stack:', error.stack);
  
  try {
    await context.sendActivity(
      "Xin lỗi, có vẻ như đã xảy ra lỗi trong quá trình xử lý yêu cầu của bạn."
    );
  } catch (sendError) {
    console.error('❌ Lỗi khi gửi error message:', sendError);
  }
};

// Định nghĩa logic của Bot
class JiraTeamsBot extends TeamsActivityHandler {
  constructor() {
    super();

    // Xử lý tin nhắn text
    this.onMessage(async (context, next) => {
      try {
        const text = context.activity.text;
        console.log(`📝 Received message: ${text}`);
        
        if (text && text.toLowerCase().includes("hello")) {
          await context.sendActivity(
            `Chào bạn! Tôi là bot thông báo Jira. Tôi có thể giúp bạn theo dõi các thay đổi trên Jira và bình luận ngược lại.`
          );
        } else {
          await context.sendActivity(
            `Tôi không hiểu lệnh "${text}". Vui lòng tương tác qua các thẻ thông báo Jira hoặc gửi "hello" để kiểm tra.`
          );
        }
      } catch (error) {
        console.error('❌ Error in onMessage:', error);
        await context.sendActivity('Xin lỗi, có lỗi xảy ra khi xử lý tin nhắn của bạn.');
      }
      
      await next();
    });

    // Xử lý thành viên được thêm vào
    this.onMembersAdded(async (context, next) => {
      const membersAdded = context.activity.membersAdded;
      const welcomeText = 'Chào mừng bạn đến với Jira Teams Bot! Gửi "hello" để bắt đầu.';
      
      for (let member of membersAdded) {
        if (member.id !== context.activity.recipient.id) {
          await context.sendActivity(MessageFactory.text(welcomeText));
        }
      }
      
      await next();
    });

    // Xử lý Adaptive Card actions
    this.onAdaptiveCardInvoke = this.handleAdaptiveCardInvoke.bind(this);
  }

  async handleAdaptiveCardInvoke(context, invokeValue) {
    console.log('🎯 Adaptive Card Invoke received:', JSON.stringify(invokeValue, null, 2));
    
    try {
      // Lấy dữ liệu từ action
      const actionData = invokeValue.action?.data || {};
      const commentText = actionData.commentInput;
      const issueKey = actionData.issueKey;

      console.log(`📝 Comment: ${commentText}`);
      console.log(`🎫 Issue Key: ${issueKey}`);

      // Kiểm tra dữ liệu đầu vào
      if (!commentText || !commentText.trim()) {
        await context.sendActivity(
          MessageFactory.text('⚠️ Vui lòng nhập nội dung bình luận trước khi gửi.')
        );
        return { status: 200, body: 'Empty comment' };
      }

      if (!issueKey) {
        await context.sendActivity(
          MessageFactory.text('⚠️ Không tìm thấy thông tin Issue Key. Vui lòng thử lại.')
        );
        return { status: 200, body: 'Missing issue key' };
      }

      // Thêm bình luận vào Jira
      await this.addCommentToJira(context, issueKey, commentText.trim());
      
      return { status: 200, body: 'Comment processed successfully' };
      
    } catch (error) {
      console.error('❌ Error in handleAdaptiveCardInvoke:', error);
      
      try {
        await context.sendActivity(
          MessageFactory.text('❌ Có lỗi xảy ra khi xử lý bình luận. Vui lòng thử lại sau.')
        );
      } catch (sendError) {
        console.error('❌ Error sending error message:', sendError);
      }
      
      return { status: 500, body: error.message };
    }
  }

  async addCommentToJira(context, issueKey, commentText) {
    try {
      console.log(`🔄 Adding comment to Jira issue: ${issueKey}`);
      
      const jiraAuth = Buffer.from(`${JIRA_USERNAME}:${JIRA_API_TOKEN}`).toString('base64');
      
      const response = await axios.post(
        `${JIRA_API_BASE_URL}/issue/${issueKey}/comment`,
        { 
          body: {
            type: "doc",
            version: 1,
            content: [
              {
                type: "paragraph",
                content: [
                  {
                    type: "text",
                    text: commentText
                  }
                ]
              }
            ]
          }
        },
        {
          headers: {
            'Authorization': `Basic ${jiraAuth}`,
            'Content-Type': 'application/json',
            'Accept': 'application/json'
          },
          timeout: 10000 // 10 seconds timeout
        }
      );

      console.log(`✅ Comment added successfully to ${issueKey}`);
      
      await context.sendActivity(
        MessageFactory.text(`✅ Bình luận của bạn đã được thêm vào issue **${issueKey}** trên Jira thành công.`)
      );
      
    } catch (error) {
      console.error(`❌ Lỗi khi thêm bình luận vào Jira cho issue ${issueKey}:`, error.message);
      
      let errorMessage = `❌ Xin lỗi, không thể thêm bình luận vào issue **${issueKey}**.`;
      
      if (error.response) {
        console.error('Jira API Response Status:', error.response.status);
        console.error('Jira API Response Data:', error.response.data);
        
        if (error.response.status === 401) {
          errorMessage += ' Lỗi xác thực - vui lòng kiểm tra API token.';
        } else if (error.response.status === 403) {
          errorMessage += ' Không có quyền - vui lòng kiểm tra quyền truy cập.';
        } else if (error.response.status === 404) {
          errorMessage += ' Không tìm thấy issue - vui lòng kiểm tra Issue Key.';
        } else {
          errorMessage += ` Lỗi ${error.response.status}: ${error.response.data?.errorMessages?.[0] || 'Unknown error'}.`;
        }
      } else if (error.code === 'ECONNABORTED') {
        errorMessage += ' Timeout - vui lòng thử lại sau.';
      } else {
        errorMessage += ' Vui lòng thử lại sau.';
      }
      
      await context.sendActivity(MessageFactory.text(errorMessage));
      throw error;
    }
  }
}

// Khởi tạo Bot
const bot = new JiraTeamsBot();

// Middleware
app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '50mb' }));

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ 
    status: 'healthy', 
    timestamp: new Date().toISOString(),
    port: PORT
  });
});

// Endpoint để nhận Webhook từ Jira
app.post("/jira-webhook", async (req, res) => {
  console.log(`📨 Received Jira webhook: ${req.headers['x-atlassian-webhook-identifier'] || 'unknown'}`);
  
  try {
    const jiraPayload = req.body;
    
    // Kiểm tra payload
    if (!jiraPayload || !jiraPayload.issue) {
      console.log('⚠️ Invalid payload - missing issue data');
      return res.status(400).send('Invalid payload');
    }

    const issue = jiraPayload.issue;
    const projectKey = issue?.fields?.project?.key;
    const eventType = jiraPayload.webhookEvent;

    console.log(`🎯 Processing event: ${eventType} for issue: ${issue.key}`);

    // Xác định target webhook URL
    let targetTeamsWebhookUrl = DEFAULT_TEAMS_WEBHOOK_URL;
    if (projectKey && projectChannelMap[projectKey]) {
      targetTeamsWebhookUrl = projectChannelMap[projectKey];
      console.log(`📍 Using custom URL for project ${projectKey}`);
    } else {
      console.log(`📍 Using default URL for project ${projectKey}`);
    }

    // Xây dựng nội dung thông báo
    const notificationData = buildNotificationData(jiraPayload);
    
    if (!notificationData) {
      console.log('⚠️ No notification data generated');
      return res.status(200).send('No notification needed');
    }

    // Tạo Adaptive Card
    const adaptiveCard = createAdaptiveCard(notificationData);

    // Gửi đến Teams
    await axios.post(targetTeamsWebhookUrl, {
      type: "message",
      attachments: [
        {
          contentType: "application/vnd.microsoft.card.adaptive",
          content: adaptiveCard,
        },
      ],
    }, {
      timeout: 10000,
      headers: {
        'Content-Type': 'application/json'
      }
    });

    console.log(`✅ Notification sent successfully for ${issue.key}`);
    res.status(200).send("Webhook processed successfully");
    
  } catch (error) {
    console.error(`❌ Error processing webhook:`, error.message);
    
    if (error.response) {
      console.error('Teams API Response:', error.response.status, error.response.data);
    }
    
    // Vẫn trả về 200 để tránh Jira retry
    res.status(200).send("Webhook processed with errors");
  }
});

// Hàm xây dựng dữ liệu thông báo
function buildNotificationData(jiraPayload) {
  const issue = jiraPayload.issue;
  const eventType = jiraPayload.webhookEvent;
  const user = jiraPayload.user || jiraPayload.changelog?.author || jiraPayload.comment?.author;
  const changelog = jiraPayload.changelog;
  const comment = jiraPayload.comment;

  if (!issue || !eventType) {
    return null;
  }

  const issueKey = issue.key;
  const issueSummary = issue.fields?.summary || "N/A";
  const projectName = issue.fields?.project?.name || "N/A";
  const userName = user?.displayName || user?.name || "Người dùng ẩn danh";
  
  // Tạo issue link
  let issueLink = null;
  if (issue.self) {
    issueLink = issue.self.replace(/rest\/api\/\d+\/issue/, "browse");
  } else if (JIRA_API_BASE_URL) {
    const baseUrl = JIRA_API_BASE_URL.replace(/\/rest\/api\/\d+$/, '');
    issueLink = `${baseUrl}/browse/${issueKey}`;
  }

  let cardTitle = "Thông báo Jira";
  let cardText = "";

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
          cardText += `- **${fieldName}**: "${oldValue}" → "${newValue}"\n`;
        });
      }
      break;
      
    case "comment_created":
      cardTitle = `[${projectName}] Bình luận Mới: ${issueKey} - ${issueSummary}`;
      cardText = `**${userName}** đã thêm bình luận:\n\n*${comment?.body || "Không có nội dung bình luận"}*`;
      break;
      
    case "jira:issue_assigned":
      const assigneeName = issue.fields?.assignee?.displayName || "chưa gán";
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

  return {
    cardTitle,
    cardText,
    issueKey,
    issueSummary,
    projectName,
    userName,
    issueLink,
    eventType
  };
}

// Hàm tạo Adaptive Card
function createAdaptiveCard(data) {
  const card = {
    $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
    type: "AdaptiveCard",
    version: "1.2",
    body: [
      {
        type: "TextBlock",
        text: data.cardTitle,
        size: "Large",
        weight: "Bolder",
        wrap: true,
        color: "Accent",
      },
      {
        type: "TextBlock",
        text: data.cardText,
        wrap: true,
        spacing: "Medium",
      },
      {
        type: "FactSet",
        facts: [
          { title: "Dự án:", value: data.projectName },
          { title: "Issue ID:", value: data.issueKey },
          { title: "Người thực hiện:", value: data.userName },
          { title: "Thời gian:", value: new Date().toLocaleString("vi-VN") },
        ],
      },
      {
        type: "Input.Text",
        id: "commentInput",
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
              issueKey: data.issueKey,
            },
          },
          issueKey: data.issueKey,
        },
      }
    ],
  };

  // Thêm action xem issue nếu có link
  if (data.issueLink) {
    card.actions.push({
      type: "Action.OpenUrl",
      title: `Xem Issue ${data.issueKey} trên Jira`,
      url: data.issueLink,
    });
  }

  return card;
}

// Endpoint cho Bot Framework
app.post("/api/messages", (req, res) => {
  console.log(`🤖 Bot message received from: ${req.headers['user-agent'] || 'unknown'}`);
  
  adapter.processActivity(req, res, async (context) => {
    try {
      await bot.run(context);
    } catch (error) {
      console.error('❌ Error in bot.run:', error);
      throw error;
    }
  });
});

// Endpoint test
app.get("/test", (req, res) => {
  res.json({
    message: "Bot server is running",
    endpoints: {
      health: "/health",
      botMessages: "/api/messages",
      jiraWebhook: "/jira-webhook"
    },
    timestamp: new Date().toISOString()
  });
});

// Khởi động Server
app.listen(PORT, () => {
  console.log(`🚀 Server đang chạy tại cổng ${PORT}`);
  console.log(`📋 Endpoints:`);
  console.log(`   Health check: http://localhost:${PORT}/health`);
  console.log(`   Bot messages: http://localhost:${PORT}/api/messages`);
  console.log(`   Jira webhook: http://localhost:${PORT}/jira-webhook`);
  console.log(`   Test: http://localhost:${PORT}/test`);
  console.log(`\n💡 Sử dụng ngrok để public endpoints:`);
  console.log(`   ngrok http ${PORT}`);
  console.log(`   Sau đó cập nhật Azure Bot endpoint: https://your-ngrok-url.ngrok.io/api/messages`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('📴 Received SIGTERM, shutting down gracefully...');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('📴 Received SIGINT, shutting down gracefully...');
  process.exit(0);
});

// Unhandled promise rejection
process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
});

// Uncaught exception
process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught Exception:', error);
  process.exit(1);
});