// Offline Apple Vision comparator. `--boxes` includes original-image word coordinates.
import Foundation
import Vision
import ImageIO
let url = URL(fileURLWithPath: CommandLine.arguments[1])
let request = VNRecognizeTextRequest()
request.recognitionLevel = .accurate
request.recognitionLanguages = ["en-US"]
request.usesLanguageCorrection = false
try VNImageRequestHandler(url: url).perform([request])
let source = CGImageSourceCreateWithURL(url as CFURL, nil)!
let props = CGImageSourceCopyPropertiesAtIndex(source, 0, nil)! as NSDictionary
let width = props[kCGImagePropertyPixelWidth] as! Double
let height = props[kCGImagePropertyPixelHeight] as! Double
var words: [[Any]] = []
let rows = (request.results ?? []).compactMap { observation -> [String: Any]? in
    guard let candidate = observation.topCandidates(1).first else { return nil }
    let text = candidate.string
    let pattern = try! NSRegularExpression(pattern: "\\S+")
    for match in pattern.matches(in: text, range: NSRange(text.startIndex..., in: text)) {
        guard let range = Range(match.range, in: text), let box = try? candidate.boundingBox(for: range) else { continue }
        let r = box.boundingBox
        words.append([r.minX * width, (1 - r.maxY) * height, r.maxX * width, (1 - r.minY) * height, String(text[range])])
    }
    return ["text": text, "confidence": candidate.confidence]
}
let result: Any = CommandLine.arguments.contains("--boxes") ? ["rows": rows, "words": words, "w": width, "h": height, "revision": request.revision] : rows
let data = try JSONSerialization.data(withJSONObject: result, options: [.sortedKeys])
print(String(data: data, encoding: .utf8)!)
