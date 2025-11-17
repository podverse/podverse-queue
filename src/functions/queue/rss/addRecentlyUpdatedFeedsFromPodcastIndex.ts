import { FeedService } from 'podverse-orm';
import { QueueName, ActiveMQArtemisService } from "@queue/services/activeMQArtemis";
import { PodcastIndexService } from 'podverse-external-services';
import { MQFeedMessage } from '@queue/types/mq';

type QueueRSSAddAllRecentlyUpdatedFeedsOptions = {
  queueName: QueueName;
  sinceRange: number;
}

export const queueRSSAddRecentlyUpdatedFeedsFromPodcastIndex = async (
  activeMQArtemisService: ActiveMQArtemisService,
  podcastIndexService: PodcastIndexService,
  options: QueueRSSAddAllRecentlyUpdatedFeedsOptions
) => {
  const sinceRange = options.sinceRange;
  const recentlyUpdatedFeeds = await podcastIndexService.recentGetData(sinceRange);
  
  await activeMQArtemisService.initialize();

  for (const feed of recentlyUpdatedFeeds) {
    const feedService = new FeedService();
    const dbFeed = await feedService.getByPodcastIndexId({ podcast_index_id: feed.feedId });
    const shouldAddToQueue = !!dbFeed;

    if (shouldAddToQueue) {
      const message: MQFeedMessage = {
        url: feed.feedUrl,
        podcast_index_id: feed.feedId
      };
  
      await activeMQArtemisService.sendMessage(options.queueName, message);
    }
  }
};
