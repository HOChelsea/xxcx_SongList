import json
import os

def update_song_txt(json_path='song.json', output_path='song_names_sorted.txt'):
    # Determine absolute paths relative to script location
    base_dir = os.path.dirname(os.path.abspath(__file__))
    json_file = os.path.join(base_dir, json_path)
    output_file = os.path.join(base_dir, output_path)

    if not os.path.exists(json_file):
        print(f"Error: Could not find '{json_file}'.")
        return

    # Read song.json
    with open(json_file, 'r', encoding='utf-8') as f:
        data = json.load(f)

    songs = data.get('songs', [])
    
    # Extract song names and sort by character count (length), then alphabetically
    song_names = [s['songName'] for s in songs if 'songName' in s]
    sorted_names = sorted(song_names, key=lambda name: (len(name), name))

    # Write sorted names to txt file
    with open(output_file, 'w', encoding='utf-8') as f:
        for name in sorted_names:
            f.write(name + '\n')

    print(f"Successfully updated '{output_path}'!")
    print(f"Total songs: {len(sorted_names)}")
    if sorted_names:
        print(f"Shortest song name: {sorted_names[0]} ({len(sorted_names[0])} chars)")
        print(f"Longest song name:  {sorted_names[-1]} ({len(sorted_names[-1])} chars)")

if __name__ == '__main__':
    update_song_txt()
