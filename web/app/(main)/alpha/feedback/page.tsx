import { Metadata } from "next"
import FeedbackForm from "./feedback-form"
export const metadata: Metadata = { title: "Alpha Feedback" }
export default function FeedbackPage() { return <FeedbackForm /> }
