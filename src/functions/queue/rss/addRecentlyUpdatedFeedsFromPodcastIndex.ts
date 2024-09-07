import { podcastIndexService } from '@queue/factories/podcastIndex';
import { QueueName, RabbitMQService } from "@queue/services/rabbitmq";

type QueueRSSAddAllConfig = {
  queueName: QueueName;
}

export const queueRSSAddRecentlyUpdatedFeedsFromPodcastIndex = async (config: QueueRSSAddAllConfig) => {
  const recentlyUpdatedFeeds = await podcastIndexService.getRecentlyUpdatedData();
  
  const rabbitMQService = new RabbitMQService();
  await rabbitMQService.initialize();

  for (const feed of recentlyUpdatedFeeds) {
    const message = {
      url: feed.feedUrl,
      podcast_index_id: feed.feedId
    };

    await rabbitMQService.sendMessage(config.queueName, message);
  }
};
