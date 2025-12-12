import { parseRSSFeedAndSaveToDatabase } from "podverse-parser";
import { MQQueueName, ActiveMQArtemisService } from "@queue/services/activeMQArtemis";

export const mqRSSRunParser = async (
  activeMQArtemisService: ActiveMQArtemisService,
  queueName: MQQueueName
) => {
  await activeMQArtemisService.initialize();

  await activeMQArtemisService.consumeMessages(queueName, async (context) => {
    try {
      const bodyStr = (context.message?.body as string) ?? '';
      const receivedMessage = JSON.parse(bodyStr);

      const { url, podcast_index_id, options } = receivedMessage;
      if (url || podcast_index_id) {
        await parseRSSFeedAndSaveToDatabase(url, podcast_index_id, options);
        context.delivery?.accept();
      } else {
        throw new Error(`mqRSSRunParser: url or podcast_index_id not found in message ${bodyStr}`);
      }
    } catch (error) {
      console.error('Error processing message', error as Error);
      context.delivery?.reject({
        condition: 'podverse:processing-error',
        description: (error as Error).message,
      });
    }
  });
};
