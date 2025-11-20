import { parseRSSFeedAndSaveToDatabase } from "podverse-parser";
import { MQQueueName, ActiveMQArtemisService } from "@queue/services/activeMQArtemis";

export const mqRSSRunParser = async (
  activeMQArtemisService: ActiveMQArtemisService,
  queueName: MQQueueName
) => {
  await activeMQArtemisService.initialize();

  await activeMQArtemisService.consumeMessages(queueName, async (message) => {
    try {
      const receivedMessageString = message.content.toString();
      const receivedMessage = JSON.parse(receivedMessageString);

      const { url, podcast_index_id } = receivedMessage;
      if (url || podcast_index_id) {
        await parseRSSFeedAndSaveToDatabase(url, podcast_index_id);
      } else {
        throw new Error(`mqRSSRunParser: url or podcast_index_id not found in message ${receivedMessage?.toString()}`);
      }
    } catch (error) {
      console.error('Error processing message', error as Error);
    }
  });
};
