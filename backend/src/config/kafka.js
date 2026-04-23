import { Kafka } from 'kafkajs' ;


const kafka = new Kafka({
  clientId: 'orchestrator',
  brokers: [process.env.KAFKA_BROKER || '147.102.19.168:30004'],
})

export const producer = kafka.producer()
const admin = kafka.admin()


// Send a message — throws error if topic does not exist
export async function publishEvent(topic, message) {
    try {
      // Check if topic exists
      await admin.connect()
      const topics = await admin.listTopics()
      await admin.disconnect()
  
      if (!topics.includes(topic)) {
        throw new Error(`Topic "${topic}" does not exist. Create it first in Kafdrop.`)
      }
  
      // Topic exists — send the message
      await producer.send({
        topic,
        messages: [{ value: JSON.stringify(message) }]
      })
  
      console.log(`[Kafka] Event published to topic: ${topic}`)
    } catch (error) {
      console.error(`[Kafka] Failed to publish event:`, error.message)
      throw error  // re-throw so the controller knows it failed
    }
  }
export async function initKafka() {
    try {
      await producer.connect()
      console.log('Kafka producer connected')
    } catch (error) {
      console.log('Kafka connection failed:', error.message)
      // don't crash the server if Kafka is unavailable
    }
  }

