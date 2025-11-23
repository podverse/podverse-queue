import { PodcastIndexService } from 'podverse-external-services';
import { MQQueueConfig } from 'podverse-helpers';
import { FeedService } from 'podverse-orm';
import { ActiveMQArtemisService } from "@queue/services/activeMQArtemis";
import { MQFeedMessage } from '@queue/types/mq';

type MQRSSAddAllRecentlyUpdatedFeedsOptions = MQQueueConfig & {
  sinceRange: number;
}

export const mqRSSAddRecentlyUpdatedFeedsFromPodcastIndex = async (
  activeMQArtemisService: ActiveMQArtemisService,
  podcastIndexService: PodcastIndexService,
  options: MQRSSAddAllRecentlyUpdatedFeedsOptions
) => {
  const sinceRange = options.sinceRange;
  const recentlyUpdatedFeeds = await podcastIndexService.recentGetData(sinceRange);
  
  await activeMQArtemisService.initialize();

  for (const feed of recentlyUpdatedFeeds) {
    const feedService = new FeedService();
    const podcast_index_id = feed.feedId;
    const dbFeed = await feedService.getByPodcastIndexId(podcast_index_id);
    const shouldAddToQueue = !!dbFeed;

    if (shouldAddToQueue) {
      const message: MQFeedMessage = {
        url: feed.feedUrl,
        podcast_index_id: feed.feedId
      };
  
      await activeMQArtemisService.sendMessage({
        queueName: options.queueName,
        message,
        priority: options.priority,
        dedupeCacheTimeMS: options.dedupeCacheTimeMS
      });
    }
  }
};
