import { FeedService } from 'podverse-orm';
import { podcastIndexService } from '@queue/factories/podcastIndex';
import { QueueName, RabbitMQService } from "@queue/services/rabbitmq";

type QueueRSSAddAllOptions = {
  queueName: QueueName;
}

export const queueRSSAddRecentlyUpdatedFeedsFromPodcastIndex = async (options: QueueRSSAddAllOptions) => {
  const recentlyUpdatedFeeds = await podcastIndexService.recentGetData();
  
  const rabbitMQService = new RabbitMQService();
  await rabbitMQService.initialize();

  for (const feed of recentlyUpdatedFeeds) {
    const feedService = new FeedService();
    console.log(`Processing feed: ${feed.feedId}, url: ${feed.feedUrl}`);
    const dbFeed = await feedService.getByPodcastIndexId({ podcast_index_id: feed.feedId });
    const shouldAddToQueue = !!dbFeed;
    console.log(`Should add to queue? ${shouldAddToQueue}`);

    if (shouldAddToQueue) {
      const message = {
        url: feed.feedUrl,
        podcast_index_id: feed.feedId
      };
  
      await rabbitMQService.sendMessage(options.queueName, message);
    }
  }
};
