import { parseRSSFeedAndSaveToDatabase } from "podverse-parser";
import { QueueName, RabbitMQService } from "@queue/services/rabbitmq";

export const queueRSSRunParser = async (
  rabbitMQService: RabbitMQService,
  queueName: QueueName
) => {
  await rabbitMQService.initialize();

  await rabbitMQService.consumeMessages(queueName, async (message) => {
    try {
      const receivedMessageString = message.content.toString();
      const receivedMessage = JSON.parse(receivedMessageString);

      const { url, podcast_index_id } = receivedMessage;
      console.log(`url ${url}`);
      console.log(`podcast_index_id ${podcast_index_id}`);
      if (url || podcast_index_id) {
        await parseRSSFeedAndSaveToDatabase(url, podcast_index_id);
      } else {
        throw new Error(`queueRSSRunParser: url or podcast_index_id not found in message ${receivedMessage?.toString()}`);
      }
    } catch (error) {
      console.error('Error processing message', error as Error);
    }
  });
};
