import { DeckType } from 'src/anki/entities/deck.entity';
import { ChatContextType, ChatType } from '../dto/create-chat-message.dto';
import { PromptConfig } from '../entities/chat-message.entity';

export const getSystemPrompt = (deckType: DeckType) => {
  return `
You are a text explanation and question answering assistant.
`;
};

export const getRetrievalUserPrompt = (context: string, question: string) => {
  return `
Below is the retrieved context from our Deck:
${context}

Question:
${question}

Response Guidelines:
1. When responding, please use a conversational, engaging tone. Base your answer primarily on the context provided.
2. If the context doesn't fully cover the topic, feel free to supplement with your own knowledge, but make it clear when you're going beyond what was discussed in the context.
3. In your response, briefly mention how the context informed your answer.
4. Use casual language, occasional humor, and a warm, approachable style.
5. If the context doesn't address the question, acknowledge this gap, offer your best insights
  `;
};

export function generatePrompt(
  chatcontext: ChatContextType,
  contextContent: string,
  chattype: ChatType,
  selectionText: string,
  question: string,
) {
  // 处理上下文部分
  let contextPrompt = '';
  switch (chatcontext) {
    case ChatContextType.Deck:
      contextPrompt = contextContent
        ? '以下是当前学习牌组的内容作为上下文：\n\n' + contextContent + '\n\n'
        : '';
      break;
    case ChatContextType.Card:
      contextPrompt = contextContent
        ? '以下是当前卡片的内容作为上下文：\n\n' + contextContent + '\n\n'
        : '';
      break;
    case ChatContextType.None:
    default:
      contextPrompt = '';
      break;
  }

  // 处理用户选中的文本（只在 explain 或 ask 类型时使用）
  const selectedContent =
    (chattype === ChatType.Explain || chattype === ChatType.Ask) &&
    selectionText
      ? `用户选中的内容：${selectionText}\n\n`
      : '';

  // 处理问题部分（只在 generic 或 ask 类型时使用）
  const questionContent =
    (chattype === ChatType.Generic || chattype === ChatType.Ask) && question
      ? `问题：${question}\n\n`
      : '';

  // 根据应用类型构建提示词
  let typePrompt = '';
  switch (chattype) {
    case ChatType.Explain:
      typePrompt = `请对${
        selectionText ? '选中的内容' : '上下文中的知识点'
      }提供详细解释。`;
      break;

    case ChatType.Ask:
      typePrompt = `基于${selectionText ? '选中的内容' : '上下文'}，请回答

请提供全面而准确的回答，可以包括：
- 主要概念的解释
- 相关例子或应用
- 必要的背景知识
- 关键点的强调

回答应当有结构性，便于理解和记忆。`;
      break;

    case ChatType.Generic:
    default:
      typePrompt = `请提供帮助：

请提供简洁明了的回答，根据问题需要可以包括解释、举例、比较或分析。回答应当直接针对问题核心，并与Anki学习卡片的上下文相关。`;
      break;
  }

  // 组合最终的 prompt
  const finalPrompt = `${contextPrompt}${selectedContent}${questionContent}${typePrompt}`;

  return finalPrompt;
}

export const generateSimplifiedPromptDisplay = (promptConfig: PromptConfig) => {
  const { chatcontext, contextContent, chattype, selectionText, question } =
    promptConfig;

  // 简化上下文展示
  let contextDisplay = '';
  if (contextContent) {
    switch (chatcontext) {
      case ChatContextType.Deck:
        contextDisplay = '基于该牌组，';
        break;
      case ChatContextType.Card:
        contextDisplay = '基于该卡片，';
        break;
      default:
        contextDisplay = '';
        break;
    }
  }

  // 简化选中内容展示
  const selectionDisplay = selectionText ? `关于"${selectionText}"，` : '';

  // 简化交互类型展示
  let typeDisplay = '';
  switch (chattype) {
    case ChatType.Explain:
      typeDisplay = '解释';
      break;
    case ChatType.Ask:
      typeDisplay = '回答';
      break;
    case ChatType.Generic:
      typeDisplay = '帮助';
      break;
  }

  // 简化问题展示
  const questionDisplay = question ? `"${question}"` : '';

  // 组合最终的简洁展示
  let simplifiedDisplay = `${contextDisplay}${selectionDisplay}${typeDisplay}${
    questionDisplay ? ` ${questionDisplay}` : ''
  }`;

  // 确保首字母大写，结尾添加适当标点
  simplifiedDisplay =
    simplifiedDisplay.charAt(0).toUpperCase() + simplifiedDisplay.slice(1);
  if (
    !simplifiedDisplay.endsWith('.') &&
    !simplifiedDisplay.endsWith('?') &&
    !simplifiedDisplay.endsWith('!')
  ) {
    simplifiedDisplay += '.';
  }

  return simplifiedDisplay;
};
