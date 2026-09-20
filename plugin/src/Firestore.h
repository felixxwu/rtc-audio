#pragma once

#include <juce_core/juce_core.h>

#include <cstdio>
#include <ctime>

// Minimal Google Cloud Firestore REST client for the public, unauthenticated
// rtc-audio database. No API keys/tokens are sent — the database has no auth.
namespace firestore
{
    // The '(' and ')' around "default" must be percent-encoded or juce::URL
    // (and some HTTP stacks) can mangle the literal parens in the path.
    static const juce::String baseUrl =
        "https://firestore.googleapis.com/v1/projects/rtc-audio/databases/%28default%29/documents";

    //==============================================================================
    // Internal helpers (encoding/decoding Firestore's typed JSON "fields" format).
    namespace detail
    {
        static const char* timestampTagKey = "__firestore_ts";

        inline juce::var encodeValue (const juce::var& v);
        inline juce::var decodeValue (const juce::var& v);

        // A timestamp() var is a DynamicObject carrying only "__firestore_ts";
        // detect it before falling into the generic "nested object" case.
        inline bool isTimestampTag (const juce::var& v)
        {
            if (auto* obj = v.getDynamicObject())
                return obj->hasProperty (timestampTagKey) && obj->getProperties().size() == 1;
            return false;
        }

        // JUCE's Time::toISO8601 emits an offset like "+00:00" rather than a
        // trailing "Z"; Firestore expects RFC3339 with "Z" for UTC.
        // Firestore wants RFC3339 in UTC. juce::Time::toISO8601 formats in LOCAL
        // time with a numeric offset ("...+0100"), so building the string from
        // it produced values Firestore rejected outright. gmtime_r is exact and
        // has no timezone surprises.
        inline juce::String millisToRfc3339 (juce::int64 millis)
        {
            const std::time_t seconds = (std::time_t) (millis / 1000);
            const int fractionalMs    = (int) (((millis % 1000) + 1000) % 1000);

            // gmtime_r is POSIX-only; MSVC has gmtime_s, whose arguments are
            // in the opposite order.
            std::tm utc {};
          #if defined (_WIN32)
            gmtime_s (&utc, &seconds);
          #else
            gmtime_r (&seconds, &utc);
          #endif

            char buffer[40];
            std::snprintf (buffer, sizeof (buffer), "%04d-%02d-%02dT%02d:%02d:%02d.%03dZ",
                           utc.tm_year + 1900, utc.tm_mon + 1, utc.tm_mday,
                           utc.tm_hour, utc.tm_min, utc.tm_sec, fractionalMs);

            return juce::String (buffer);
        }

        // Encode one plain juce::var property into a Firestore typed value
        // object, e.g. {"integerValue": "3"} or {"mapValue": {"fields": {...}}}.
        inline juce::var encodeValue (const juce::var& v)
        {
            auto* result = new juce::DynamicObject();

            if (isTimestampTag (v))
            {
                auto millis = (juce::int64) v.getDynamicObject()->getProperty (timestampTagKey);
                result->setProperty ("timestampValue", millisToRfc3339 (millis));
            }
            else if (v.isVoid() || v.isUndefined())
            {
                result->setProperty ("nullValue", juce::var());
            }
            else if (v.isBool())
            {
                result->setProperty ("booleanValue", v);
            }
            else if (v.isInt() || v.isInt64())
            {
                // Firestore requires integerValue to be encoded as a decimal STRING.
                result->setProperty ("integerValue", juce::String ((juce::int64) v));
            }
            else if (v.isDouble())
            {
                result->setProperty ("doubleValue", v);
            }
            else if (v.isString())
            {
                result->setProperty ("stringValue", v.toString());
            }
            else if (v.isArray())
            {
                juce::Array<juce::var> encoded;
                for (auto& item : *v.getArray())
                    encoded.add (encodeValue (item));

                auto* arrWrap = new juce::DynamicObject();
                arrWrap->setProperty ("values", encoded);

                result->setProperty ("arrayValue", juce::var (arrWrap));
            }
            else if (auto* obj = v.getDynamicObject())
            {
                auto* fields = new juce::DynamicObject();
                for (auto& prop : obj->getProperties())
                    fields->setProperty (prop.name, encodeValue (prop.value));

                auto* mapWrap = new juce::DynamicObject();
                mapWrap->setProperty ("fields", juce::var (fields));

                result->setProperty ("mapValue", juce::var (mapWrap));
            }
            else
            {
                result->setProperty ("nullValue", juce::var());
            }

            return juce::var (result);
        }

        // Encode a plain juce::var object's top-level properties into a
        // Firestore "fields" map, ready to nest under {"fields": {...}}.
        inline juce::var encodeFields (const juce::var& fieldsObj)
        {
            auto* fields = new juce::DynamicObject();

            if (auto* obj = fieldsObj.getDynamicObject())
                for (auto& prop : obj->getProperties())
                    fields->setProperty (prop.name, encodeValue (prop.value));

            return juce::var (fields);
        }

        // Decode one Firestore typed value back into a plain juce::var.
        // integerValue arrives as a string and is parsed back to int64 so
        // callers can do ordinary numeric comparisons; timestampValue (an
        // RFC3339 string) is converted to millis-since-epoch for the same reason.
        inline juce::var decodeValue (const juce::var& v)
        {
            auto* obj = v.getDynamicObject();
            if (obj == nullptr)
                return {};

            if (obj->hasProperty ("nullValue"))
                return {};
            if (obj->hasProperty ("booleanValue"))
                return obj->getProperty ("booleanValue");
            if (obj->hasProperty ("doubleValue"))
                return obj->getProperty ("doubleValue");
            if (obj->hasProperty ("stringValue"))
                return obj->getProperty ("stringValue");
            if (obj->hasProperty ("integerValue"))
                return juce::var ((juce::int64) obj->getProperty ("integerValue").toString().getLargeIntValue());
            if (obj->hasProperty ("timestampValue"))
            {
                auto t = juce::Time::fromISO8601 (obj->getProperty ("timestampValue").toString());
                return juce::var ((juce::int64) t.toMilliseconds());
            }
            if (obj->hasProperty ("mapValue"))
            {
                auto* result = new juce::DynamicObject();
                if (auto* mapObj = obj->getProperty ("mapValue").getDynamicObject())
                {
                    if (auto* innerFields = mapObj->getProperty ("fields").getDynamicObject())
                        for (auto& prop : innerFields->getProperties())
                            result->setProperty (prop.name, decodeValue (prop.value));
                }
                return juce::var (result);
            }
            if (obj->hasProperty ("arrayValue"))
            {
                juce::Array<juce::var> result;
                if (auto* arrObj = obj->getProperty ("arrayValue").getDynamicObject())
                {
                    auto valuesVar = arrObj->getProperty ("values");
                    if (auto* valuesArr = valuesVar.getArray())
                        for (auto& item : *valuesArr)
                            result.add (decodeValue (item));
                }
                return result;
            }

            return {};
        }

        // Decode a Firestore document's "fields" map into a plain juce::var object.
        inline juce::var decodeFields (const juce::var& docVar)
        {
            auto* result = new juce::DynamicObject();

            if (auto* docObj = docVar.getDynamicObject())
                if (auto* fields = docObj->getProperty ("fields").getDynamicObject())
                    for (auto& prop : fields->getProperties())
                        result->setProperty (prop.name, decodeValue (prop.value));

            return juce::var (result);
        }

        // Shared GET/POST/PATCH request helper. Returns the parsed JSON body
        // and, via statusCode, the HTTP status; never throws or blocks forever
        // thanks to the fixed connection timeout.
        inline juce::var request (const juce::String& url, const juce::String& httpVerb,
                                   const juce::var& body, int& statusCode)
        {
            statusCode = 0;
            juce::URL u (url);

            juce::String postData;
            bool hasBody = false;

            if (! body.isVoid())
            {
                postData = juce::JSON::toString (body);
                hasBody = true;
            }

            if (hasBody)
                u = u.withPOSTData (postData);

            // InputStreamOptions is not copy-assignable, so the whole thing has
            // to be built in one expression. JUCE also picks GET or POST purely
            // from whether POST data was attached, so any other verb (PATCH,
            // DELETE) must be named explicitly - otherwise a bodyless DELETE
            // silently goes out as a GET.
            const auto options = [&]
            {
                auto opts = juce::URL::InputStreamOptions (juce::URL::ParameterHandling::inAddress)
                                .withExtraHeaders ("Content-Type: application/json")
                                .withConnectionTimeoutMs (10000)
                                .withStatusCode (&statusCode);

                if (httpVerb != "GET")
                    return opts.withHttpRequestCmd (httpVerb);

                return opts;
            }();

            auto stream = u.createInputStream (options);
            if (stream == nullptr)
                return {};

            auto response = stream->readEntireStreamAsString();
            if (response.isEmpty())
                return {};

            return juce::JSON::parse (response);
        }

        inline bool isSuccess (int statusCode)
        {
            return statusCode >= 200 && statusCode < 300;
        }
    }

    //==============================================================================
    // Tag a millis-since-epoch value so the encoder emits a Firestore
    // timestampValue for it instead of treating it as a nested object.
    inline juce::var timestamp (juce::int64 millisSinceEpoch)
    {
        auto* obj = new juce::DynamicObject();
        obj->setProperty (detail::timestampTagKey, millisSinceEpoch);
        return juce::var (obj);
    }

    // GET a single document and decode its fields. Returns void var on 404
    // or any other failure (network error, non-2xx, malformed body).
    inline juce::var getDoc (const juce::String& path)
    {
        int statusCode = 0;
        auto result = detail::request (baseUrl + "/" + path, "GET", {}, statusCode);

        if (! detail::isSuccess (statusCode) || result.isVoid())
            return {};

        return detail::decodeFields (result);
    }

    // DELETE one document. Subcollections are NOT removed (Firestore has no
    // recursive delete over REST); callers must delete children themselves.
    inline bool deleteDoc (const juce::String& path)
    {
        int statusCode = 0;
        detail::request (baseUrl + "/" + path, "DELETE", {}, statusCode);
        return detail::isSuccess (statusCode);
    }

    // GET a collection's documents. Each decoded object gets an extra "_id"
    // property (Firestore's document id lives in the "name" resource path,
    // not in "fields", so it must be pulled out separately).
    inline juce::Array<juce::var> listCollection (const juce::String& path)
    {
        juce::Array<juce::var> results;

        int statusCode = 0;
        auto result = detail::request (baseUrl + "/" + path, "GET", {}, statusCode);

        if (! detail::isSuccess (statusCode) || result.isVoid())
            return results;

        auto* obj = result.getDynamicObject();
        if (obj == nullptr)
            return results;

        auto documentsVar = obj->getProperty ("documents");
        auto* documents = documentsVar.getArray();
        if (documents == nullptr)
            return results;

        for (auto& docVar : *documents)
        {
            auto decoded = detail::decodeFields (docVar);

            if (auto* docObj = docVar.getDynamicObject())
            {
                auto name = docObj->getProperty ("name").toString();
                auto id = name.fromLastOccurrenceOf ("/", false, false);

                if (auto* decodedObj = decoded.getDynamicObject())
                    decodedObj->setProperty ("_id", id);
            }

            results.add (decoded);
        }

        return results;
    }

    // POST a new document. An empty docId lets Firestore assign an auto-id
    // (POST straight to the collection); a non-empty docId is passed as the
    // documentId query parameter.
    inline bool createDoc (const juce::String& path, const juce::var& fields, const juce::String& docId = {})
    {
        juce::String url = baseUrl + "/" + path;
        if (docId.isNotEmpty())
            url << "?documentId=" << juce::URL::addEscapeChars (docId, true);

        auto* body = new juce::DynamicObject();
        body->setProperty ("fields", detail::encodeFields (fields));

        int statusCode = 0;
        detail::request (url, "POST", juce::var (body), statusCode);

        return detail::isSuccess (statusCode);
    }

    // PATCH only the top-level fields present in `fields`. Firestore's PATCH
    // otherwise replaces the WHOLE document, so every top-level key must be
    // listed as an updateMask.fieldPaths query parameter or every field not
    // present in this call gets deleted server-side.
    inline bool patchDoc (const juce::String& path, const juce::var& fields)
    {
        juce::String url = baseUrl + "/" + path + "?";

        bool first = true;
        if (auto* obj = fields.getDynamicObject())
        {
            for (auto& prop : obj->getProperties())
            {
                if (! first)
                    url << "&";
                url << "updateMask.fieldPaths=" << juce::URL::addEscapeChars (prop.name.toString(), true);
                first = false;
            }
        }

        auto* body = new juce::DynamicObject();
        body->setProperty ("fields", detail::encodeFields (fields));

        int statusCode = 0;
        detail::request (url, "PATCH", juce::var (body), statusCode);

        return detail::isSuccess (statusCode);
    }

    // POST to the :commit endpoint, combining a document write with
    // server-stamped timestamps (transform REQUEST_TIME) for the named
    // fields. Used so presence docs are timestamped by Firestore's own
    // clock rather than the (possibly skewed) local client clock.
    inline bool commitDoc (const juce::String& path, const juce::var& fields,
                            const juce::StringArray& serverTimestampFields)
    {
        juce::String docName = "projects/rtc-audio/databases/(default)/documents/" + path;

        auto* update = new juce::DynamicObject();
        update->setProperty ("name", docName);
        update->setProperty ("fields", detail::encodeFields (fields));

        auto* updateWrite = new juce::DynamicObject();
        updateWrite->setProperty ("update", juce::var (update));

        juce::Array<juce::var> writes;
        writes.add (juce::var (updateWrite));

        if (! serverTimestampFields.isEmpty())
        {
            juce::Array<juce::var> fieldTransforms;
            for (auto& fieldName : serverTimestampFields)
            {
                auto* transform = new juce::DynamicObject();
                transform->setProperty ("fieldPath", fieldName);
                transform->setProperty ("setToServerValue", "REQUEST_TIME");
                fieldTransforms.add (juce::var (transform));
            }

            auto* transformOp = new juce::DynamicObject();
            transformOp->setProperty ("document", docName);
            transformOp->setProperty ("fieldTransforms", fieldTransforms);

            auto* transformWrite = new juce::DynamicObject();
            transformWrite->setProperty ("transform", juce::var (transformOp));

            writes.add (juce::var (transformWrite));
        }

        auto* body = new juce::DynamicObject();
        body->setProperty ("writes", writes);

        int statusCode = 0;
        detail::request (baseUrl + ":commit", "POST", juce::var (body), statusCode);

        return detail::isSuccess (statusCode);
    }
}
