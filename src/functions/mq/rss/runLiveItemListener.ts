import { ActiveMQArtemisService, MQQueueName } from '@queue/services/activeMQArtemis';
import { MQ_QUEUES } from 'podverse-helpers';
import { Feed, FeedService } from 'podverse-orm';
import WebSocket from 'ws';
import { mqRSSAdd } from './add';

export const mqRSSRunLiveItemListener = (
  activeMQArtemisService: ActiveMQArtemisService) => {
  console.info('starting runLiveItemListener');

  const feedService = new FeedService();

  /*
    Run an interval to keep the node script running forever.
  */
  setInterval(() => {
    console.info('runLiveItemListener interval');
  }, 100000000);

  let openedSocket: boolean | null = null;
  const timeInterval = 5000;
  const url = 'wss://api.livewire.io/ws/podping';

  let connectionIdCount = 0;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const hiveBlocksHandled: any = {};

  function connect() {
    const client = new WebSocket(url);
    return new Promise((resolve, reject) => {
      console.info('client try to connect...');

      let connectionId = connectionIdCount;

      client.on('open', () => {
        connectionId = connectionIdCount + 1;
        connectionIdCount++;
        console.info(`WEBSOCKET_OPEN: client connected to server at ${url}, connectionId: ${connectionId}`);
        openedSocket = true;
        resolve(openedSocket);
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      client.on('message', async function message(data: any) {
        try {
          const msg = JSON.parse(data);

          // If the hiveBlock was already processed by our listener, then skip the message.
          if (hiveBlocksHandled[msg.n]) return;

          const prodPodpingLiveIdRegex = new RegExp('^pp_(.*)_(live|liveEnd)$', 'i');

          if (msg.t === 'podping') {
            hiveBlocksHandled[msg.n] = true;
            for (const p of msg.p) {
              if (
                prodPodpingLiveIdRegex.test(p.i) &&
                p.p.reason &&
                (p.p.reason.toLowerCase() === 'live' || p.p.reason.toLowerCase() === 'liveend')
              ) {
                console.info(`p.p ${JSON.stringify(p.p)}, p.n Hive block number ${p.n}, connectionId: ${connectionId}`);
                const addRSSObjs: { url: string, podcast_index_id: number }[] = [];
                for (const url of p.p.iris) {
                  try {
                    if (url?.startsWith('http')) {
                      let feed: Feed | null = null;
                      try {
                        feed = await feedService.getByUrl(url);
                      } catch (error) {
                        console.info(`p.p.iris error ${error}, connectionId: ${connectionId}`);                        
                      }
                      if (feed) {
                        const { podcast_index_id } = feed;
                        const numPodcastIndexId = Number(podcast_index_id);
                        if (podcast_index_id) addRSSObjs.push({ url, podcast_index_id: numPodcastIndexId });
                      } else {
                        console.info('feed url not found');
                      }
                    }
                  } catch (err) {
                    console.info(`p.p.iris error ${err}, connectionId: ${connectionId}`);
                  }
                }
                const queueType: MQQueueName = 'rss-live';

                const mqConstantMessageOptions = MQ_QUEUES[queueType];

                for (const addRSSObj of addRSSObjs) {
                  await mqRSSAdd(
                    activeMQArtemisService,
                    {
                      ...mqConstantMessageOptions,
                      feedUrl: addRSSObj.url,
                      podcastIndexId: addRSSObj.podcast_index_id
                    }
                  );
                }
              }
            }
          }
        } catch (err) {
          console.info(`message error: ${err}, connectionId: ${connectionId}`);
        }
      });

      client.on('close', (err) => {
        console.info(`WEBSOCKET_CLOSE: connection closed ${err}, connectionId: ${connectionId}`);
        openedSocket = false;
        reject(err);
      });

      client.on('error', (err) => {
        console.info(`WEBSOCKET_ERROR: Error ${new Error(err.message)}, connectionId: ${connectionId}`);
        openedSocket = false;
        reject(err);
      });
    });
  }

  async function reconnect() {
    try {
      await connect();
    } catch (err) {
      if (err instanceof Error) {
        console.error(`reconnect error: ${err.message}`);
      } else {
        console.error(`reconnect error: ${String(err)}`);
      }
    }
  }

  reconnect();

  // repeat every 5 seconds
  setInterval(() => {
    if (!openedSocket) {
      reconnect();
    }
  }, timeInterval);
};
