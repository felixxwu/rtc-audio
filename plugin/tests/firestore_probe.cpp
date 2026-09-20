// Probes each Firestore.h call against the live project and prints what came
// back, so signalling failures are visible instead of silent.
#include "Firestore.h"
#include <juce_events/juce_events.h>
#include <cstdio>

int main()
{
    juce::ScopedJuceInitialiser_GUI init;

    // Raw POST, so the status code and body are visible.
    {
        auto* f = new juce::DynamicObject();
        f->setProperty ("createdAt", firestore::timestamp (juce::Time::currentTimeMillis()));
        f->setProperty ("expireAt",  firestore::timestamp (juce::Time::currentTimeMillis() + 3600000));
        auto* body = new juce::DynamicObject();
        body->setProperty ("fields", firestore::detail::encodeFields (juce::var (f)));

        int status = 0;
        auto resp = firestore::detail::request (firestore::baseUrl + "/calls?documentId=rawprobe",
                                                "POST", juce::var (body), status);
        std::printf ("RAW POST status=%d resp=%s\n", status,
                     juce::JSON::toString (resp).substring (0, 300).toRawUTF8());
    }

    const juce::String room = "probe" + juce::String (juce::Time::currentTimeMillis());
    const juce::String peer = "peer1";

    auto* roomFields = new juce::DynamicObject();
    roomFields->setProperty ("createdAt", firestore::timestamp (juce::Time::currentTimeMillis()));
    // Root call docs can't be deleted under the project's rules, so let the
    // TTL policy reap this probe room rather than leaving it behind.
    roomFields->setProperty ("expireAt", firestore::timestamp (juce::Time::currentTimeMillis() + 3600000));
    std::printf ("createDoc(room)      = %d\n", (int) firestore::createDoc ("calls", juce::var (roomFields), room));

    auto* presence = new juce::DynamicObject();
    presence->setProperty ("joinedAt", firestore::timestamp (juce::Time::currentTimeMillis() + 1000));
    presence->setProperty ("sharing", false);
    std::printf ("commitDoc(presence)  = %d\n",
                 (int) firestore::commitDoc ("calls/" + room + "/peers/" + peer,
                                             juce::var (presence), { "lastSeen" }));

    auto got = firestore::getDoc ("calls/" + room + "/peers/" + peer);
    std::printf ("getDoc(presence)     = %s\n", juce::JSON::toString (got).toRawUTF8());

    auto list = firestore::listCollection ("calls/" + room + "/peers");
    std::printf ("listCollection       = %d docs\n", list.size());
    for (auto& d : list)
        std::printf ("   _id=%s\n", d["_id"].toString().toRawUTF8());

    auto* patch = new juce::DynamicObject();
    patch->setProperty ("sharing", true);
    std::printf ("patchDoc             = %d\n",
                 (int) firestore::patchDoc ("calls/" + room + "/peers/" + peer, juce::var (patch)));

    std::printf ("deleteDoc            = %d\n",
                 (int) firestore::deleteDoc ("calls/" + room + "/peers/" + peer));
    return 0;
}
