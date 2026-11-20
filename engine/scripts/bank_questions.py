"""Questions the bank is built from: the things a curious audience is most likely to ask. Order is priority."""

QUESTIONS = [
    # Sun
    "What if the Sun suddenly disappeared?", "What if the Sun were twice as massive?", "What if the Sun were replaced by a black hole of the same mass?",
    "What if the Sun turned into a red giant?", "What if the Sun turned into a white dwarf?", "What if the Sun were half as massive?",
    "What if the Sun stopped shining?", "What if the Sun were a red dwarf?", "What if the Sun were a blue giant?", "What if the Sun went supernova?",
    "What if Earth had two suns?", "What if our solar system had four suns?",
    # Moon
    "What if the Moon disappeared?", "What if the Moon were twice as close?", "What if the Moon were twice as far away?", "What if the Moon crashed into Earth?",
    "What if Earth had two moons?", "What if the Moon were as big as Earth?", "What if the Moon stopped orbiting?", "What if the Moon were inside the Roche limit?",
    "What if the Moon were made of cheese?", "What if the Moon orbited the other way?", "What if Earth had rings like Saturn?",
    "What if the Moon were as close as the International Space Station?",
    # Earth
    "What if the Earth stopped spinning?", "What if the Earth spun twice as fast?", "What if the Earth spun 3,000 times faster?", "What if the Earth spun 10 times faster?",
    "What if the Earth were twice as big?", "What if the Earth were half as big?", "What if Earth were twice as heavy?", "What if Earth lost half its mass?",
    "What if Earth orbited twice as far from the Sun?", "What if Earth orbited as close as Venus?", "What if Earth were as close to the Sun as Mercury?",
    "What if Earth's orbit were very elliptical?", "What if Earth had no tilt?", "What if Earth were tilted on its side like Uranus?", "What if Earth were hollow?",
    "What if you jumped into a tunnel straight through the Earth?", "What if Earth were made entirely of gold?", "What if Earth were shaped like a donut?",
    "What if Earth were flat?", "What if Earth were a cube?", "What if Earth stopped orbiting the Sun?", "What if Earth lost its atmosphere?",
    # planets
    "What if Jupiter became a star?", "What if Jupiter disappeared?", "What if Jupiter were as close as Mars?", "What if Jupiter and Saturn swapped places?",
    "What if Mars collided with Earth?", "What if Venus collided with Earth?", "What if there were a planet between Mars and Jupiter?",
    "What if a rogue planet passed through the solar system?", "What if Earth were where Jupiter is?", "What if Saturn's rings fell into Saturn?",
    "What if Pluto crashed into Earth?", "What if Mercury were ejected from the solar system?", "What if all the planets lined up?",
    "What if Phobos crashed into Mars?", "What if a second Earth shared our orbit?",
    # gravity
    "What if gravity were 10 times weaker?", "What if gravity were twice as strong?", "What if gravity suddenly switched off?",
    "What if gravity travelled instantly instead of at the speed of light?", "What if the gravitational constant doubled?", "What if gravity were repulsive?",
    "What if Earth's gravity were as weak as the Moon's?", "What if Earth's gravity were as strong as Jupiter's?",
    # light and relativity
    "What if a spaceship flew to Proxima Centauri at 99.99% of light speed?", "What if you travelled at 90% of the speed of light for a year?",
    "What if you travelled at 99% of the speed of light?", "What if the speed of light were 100 km/h?", "What if the speed of light were twice as fast?",
    "What if you could travel faster than light?", "What if you rode a beam of light?", "What if a twin travelled to a star at near light speed and came back?",
    "What if you flew to the Andromeda galaxy at 99.9999% of light speed?", "What if a rocket accelerated at 1 g for 10 years?", "What if light stopped?",
    "What if you looked back at Earth from 100 light years away?", "What if a car drove at 99% of light speed?", "What if the Sun's light took a year to reach us?",
    # black holes
    "What if you fell into a black hole?", "What if Earth were turned into a black hole?", "What if a black hole passed through the solar system?",
    "What if a tiny black hole hit Earth?", "What if a primordial black hole the mass of an asteroid passed through Earth?", "What if two black holes merged near Earth?",
    "What if you orbited a black hole?", "What if the black hole at the centre of the Milky Way woke up?", "What if a black hole evaporated?",
    "What if a black hole swallowed the Sun?", "What if you fell into the black hole at the centre of the Milky Way?", "What if you stood next to a black hole for an hour?",
    "What is inside a black hole?", "What happens to information that falls into a black hole?",
    # stars and explosions
    "What if Betelgeuse went supernova tonight?", "What if a supernova exploded 50 light years away?", "What if a neutron star passed through the solar system?",
    "What if a pulsar were as close as Proxima Centauri?", "What if a magnetar passed by the Sun?", "What if a gamma ray burst hit Earth from 6,000 light years away?",
    "What if a teaspoon of neutron star landed on Earth?", "What if two neutron stars collided nearby?", "What if the star Gliese 710 passed through the Oort cloud?",
    "What if Proxima Centauri were as close as the Sun?", "What if a white dwarf passed by Earth?", "What if a star collided with the Sun?",
    # impacts
    "What if a 10 km asteroid hit the Pacific Ocean?", "What if a 1 km asteroid hit Earth?", "What if the dinosaur-killing asteroid missed?", "What if Apophis hit Earth?",
    "What if a comet hit the Moon?", "What if an asteroid the size of Texas hit Earth?", "What if a 100 metre asteroid hit a city?",
    "What if a comet passed between Earth and the Moon?", "What if Ceres hit Earth?", "What if a meteor shower never stopped?",
    # cosmology
    "What happened before the Big Bang?", "How will the universe end?", "What if the universe stopped expanding?", "What if dark energy keeps getting stronger?",
    "What if dark matter does not exist?", "Will the universe expand forever or collapse again?", "What if the universe started collapsing?",
    "What if the Big Bang happened again?", "What if the Andromeda galaxy collided with the Milky Way?", "What if the universe had no dark energy?",
    "What if the Hubble constant were ten times larger?", "What if there were no dark matter in the Milky Way?", "Are there other universes?",
    "What if the vacuum of space decayed?",
    # theory and speculation
    "Is our universe inside a black hole?", "Could a warp drive let us travel faster than light?", "Could a wormhole connect two distant places?",
    "Could we travel back in time?", "What if the universe is a simulation?", "What if there is a fifth force of nature?", "What if the speed of light changes over time?",
    "What if white holes exist?", "What if time ran backwards?", "Will the Sun swallow the Earth when it dies?", "What if we lived in a universe with two time dimensions?",
    "What if protons decay?",
    # quantum
    "What if an electron were fired at two slits one at a time?", "What if you could see quantum tunnelling?", "What if Planck's constant were much bigger?",
    "What if electrons were as heavy as protons?", "What if a ball tunnelled through a wall?", "What if atoms were the size of marbles?",
    # human scale
    "What if every person on Earth jumped at the same time?", "What if you dropped a bowling ball and a feather on the Moon?",
    "What if you fired a cannonball sideways at 8 km/s?", "What if you threw a baseball at 90% of the speed of light?", "What if you fell from the edge of space?",
    "What if you jumped on Mars?", "What if you jumped on the Moon?", "What if you dropped a penny from the Empire State Building?",
    "What if everyone on Earth pointed a laser at the Moon?", "What if you stood on a neutron star?",
    # thought experiments
    "What if the Sun were made of ice cream?", "What if Earth were made of water?", "What if the Moon were made of iron?", "What if the Sun were the size of a football?",
    "What if the Sun were made of wood?", "What if Earth were made of diamond?", "What if Jupiter were made of lead?", "What if the Moon were made of ice?",
    "What if the Sun were a giant cube?", "What if the Earth were the size of a marble but kept its mass?", "What if a teaspoon of the Sun's core appeared on Earth?",
    "What if the Moon were a giant mirror?", "What if you could pour the ocean into space?",
    # outside physics (instant witty replies)
    "What is the mass of love?", "What if time was purple?", "What if dragons were real?", "What does the Sun eat for breakfast?",
    "What is the meaning of life?", "What if magic existed?", "What if cats ruled the world?", "What if dinosaurs never went extinct?",
]
